import { adminClient, corsHeaders, getConnection, getGoogleAccessToken, googleApi, googleEventId, json, requireWorkspaceUser, toGoogleEvent } from '../_shared/google.ts'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const { membership, error: authError } = await requireWorkspaceUser(request)
  if (!membership) return json({ error: authError }, 401)
  const ownerId = membership.owner_id

  try {
    const input = await request.json()
    const action = input?.action || 'status'
    const admin = adminClient()

    if (action === 'status') {
      const connection = await getConnection(ownerId)
      return json({
        connected: Boolean(connection),
        email: connection?.email || '',
        lastSyncedAt: connection?.last_synced_at || '',
      })
    }

    if (action === 'disconnect') {
      if (membership.role !== 'admin') return json({ error: 'Solo el administrador puede desconectar Google Calendar.' }, 403)
      const connection = await getConnection(ownerId)
      if (connection?.refresh_token) {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: connection.refresh_token }),
        }).catch(() => undefined)
      }
      const { error } = await admin.from('google_calendar_connections').delete().eq('owner_id', ownerId)
      if (error) throw new Error('No se pudo quitar la autorización de Google.')
      return json({ connected: false })
    }

    if (action !== 'sync') return json({ error: 'Acción no reconocida.' }, 400)
    if (!Array.isArray(input.bookings) || !input.settings || typeof input.settings !== 'object') return json({ error: 'Faltan las reservas y los datos de la cancha.' }, 400)

    const connection = await getConnection(ownerId)
    if (!connection) return json({ error: 'Google Calendar no está conectado.' }, 409)
    const accessToken = await getGoogleAccessToken(ownerId)
    const calendarId = encodeURIComponent(connection.calendar_id || 'primary')
    const collectionUrl = `${CALENDAR_API}/calendars/${calendarId}/events`
    const activeBookings = input.bookings.filter((booking: Record<string, unknown>) => booking?.id && booking.status !== 'cancelled')
    const activeIds = new Set(activeBookings.map((booking: Record<string, unknown>) => String(booking.id)))
    const { data: existingEvents, error: mappingError } = await admin.from('google_calendar_events')
      .select('booking_id, event_id').eq('owner_id', ownerId)
    if (mappingError) throw new Error('No se pudo consultar la lista de eventos vinculados.')

    for (const booking of activeBookings as Record<string, unknown>[]) {
      if (!booking.date || !booking.time) continue
      const eventId = await googleEventId(String(booking.id))
      const event = toGoogleEvent(booking, input.settings, eventId)
      const eventUrl = `${collectionUrl}/${eventId}`
      const current = await googleApi(accessToken, eventUrl)
      if (current.response.ok) {
        const { id: _eventId, ...eventChanges } = event
        const updated = await googleApi(accessToken, eventUrl, 'PATCH', eventChanges)
        if (!updated.response.ok) throw new Error('Google no pudo actualizar una reserva del calendario.')
      } else if (current.response.status === 404) {
        const created = await googleApi(accessToken, collectionUrl, 'POST', event)
        if (!created.response.ok && created.response.status !== 409) throw new Error('Google no pudo crear una reserva en el calendario.')
        if (created.response.status === 409) {
          const { id: _eventId, ...eventChanges } = event
          const retried = await googleApi(accessToken, eventUrl, 'PATCH', eventChanges)
          if (!retried.response.ok) throw new Error('Google no pudo actualizar una reserva existente.')
        }
      } else {
        throw new Error('Google Calendar no respondió correctamente al consultar una reserva.')
      }
      const { error: saveMappingError } = await admin.from('google_calendar_events').upsert({
        owner_id: ownerId,
        booking_id: String(booking.id),
        event_id: eventId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'owner_id,booking_id' })
      if (saveMappingError) throw new Error('La reserva se guardó en Google, pero no se pudo actualizar el vínculo en Supabase.')
    }

    for (const row of existingEvents || []) {
      if (activeIds.has(row.booking_id)) continue
      const deleted = await googleApi(accessToken, `${collectionUrl}/${encodeURIComponent(row.event_id)}`, 'DELETE')
      if (!deleted.response.ok && deleted.response.status !== 404 && deleted.response.status !== 410) throw new Error('Google no pudo quitar un evento cancelado.')
      const { error: deleteMappingError } = await admin.from('google_calendar_events').delete()
        .eq('owner_id', ownerId).eq('booking_id', row.booking_id)
      if (deleteMappingError) throw new Error('No se pudo limpiar el vínculo de una reserva cancelada.')
    }

    const lastSyncedAt = new Date().toISOString()
    const { error: updateConnectionError } = await admin.from('google_calendar_connections')
      .update({ last_synced_at: lastSyncedAt, updated_at: lastSyncedAt }).eq('owner_id', ownerId)
    if (updateConnectionError) throw new Error('Los eventos se sincronizaron, pero no se pudo guardar la fecha de sincronización.')
    return json({ success: true, lastSyncedAt })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo sincronizar Google Calendar.' }, 500)
  }
})
