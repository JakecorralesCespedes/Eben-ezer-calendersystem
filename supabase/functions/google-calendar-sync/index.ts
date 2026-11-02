import { adminClient, corsHeaders, getConnection, getGoogleAccessToken, googleApi, googleEventId, json, requireWorkspaceUser, toGoogleEvent } from '../_shared/google.ts'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

function localParts(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

async function hashEventPayload(event: Record<string, unknown>) {
  const { id: _id, ...payload } = event
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

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

    if (action === 'pull') {
      const connection = await getConnection(ownerId)
      if (!connection) return json({ error: 'Google Calendar no está conectado.' }, 409)
      const accessToken = await getGoogleAccessToken(ownerId)
      const calendarId = encodeURIComponent(connection.calendar_id || 'primary')
      const start = new Date()
      start.setDate(start.getDate() - 90)
      const end = new Date()
      end.setDate(end.getDate() + 730)
      const params = new URLSearchParams({
        timeMin: start.toISOString(), timeMax: end.toISOString(),
        singleEvents: 'true', showDeleted: 'true', maxResults: '2500', orderBy: 'startTime',
      })
      const events: Record<string, unknown>[] = []
      let pageToken = ''
      do {
        if (pageToken) params.set('pageToken', pageToken)
        const response = await googleApi(accessToken, `${CALENDAR_API}/calendars/${calendarId}/events?${params}`)
        if (!response.response.ok) throw new Error('Google Calendar no pudo compartir los cambios recientes.')
        const page = response.data
        events.push(...(Array.isArray(page.items) ? page.items as Record<string, unknown>[] : []))
        pageToken = String(page.nextPageToken || '')
      } while (pageToken)

      const { data: mappings, error: mappingError } = await admin.from('google_calendar_events')
        .select('booking_id, event_id').eq('owner_id', ownerId)
      if (mappingError) throw new Error('No se pudo consultar la lista de eventos vinculados.')
      const bookingIdByEventId = new Map((mappings || []).map((row: { booking_id: string; event_id: string }) => [row.event_id, row.booking_id]))
      const bookings = []
      const newMappings = []
      for (const event of events) {
        const eventId = String(event.id || '')
        if (!eventId || event.status === 'cancelled' && !bookingIdByEventId.has(eventId)) continue
        const bookingId = bookingIdByEventId.get(eventId) || `google-event-${eventId}`
        const startValue = event.start as Record<string, string> | undefined
        const endValue = event.end as Record<string, string> | undefined
        let date = ''
        let time = ''
        let duration = 60
        if (startValue?.dateTime && endValue?.dateTime) {
          const startParts = localParts(startValue.dateTime)
          date = startParts.date
          time = startParts.time
          duration = Math.max(15, Math.round((new Date(endValue.dateTime).getTime() - new Date(startValue.dateTime).getTime()) / 60000))
        } else if (startValue?.date && endValue?.date) {
          date = startValue.date
          time = '00:00'
          duration = Math.max(60, Math.round((new Date(`${endValue.date}T00:00:00Z`).getTime() - new Date(`${startValue.date}T00:00:00Z`).getTime()) / 60000))
        }
        if (!date && event.status !== 'cancelled') continue
        const rawName = String(event.summary || 'Reserva de Google Calendar')
        const pending = /^Pendiente\s*[·-]/i.test(rawName)
        const name = rawName.replace(/^(Fútbol|Pendiente · Fútbol)\s*[·-]\s*/i, '')
        const calendarSource = bookingId.startsWith('google-event-') ? 'google' : 'app'
        bookings.push({
          id: bookingId,
          googleEventId: eventId,
          calendarSource,
          date,
          time,
          duration,
          name,
          status: event.status === 'cancelled' ? 'cancelled' : pending ? 'pending' : 'confirmed',
        })
        if (event.status !== 'cancelled' && !bookingIdByEventId.has(eventId)) {
          newMappings.push({ owner_id: ownerId, booking_id: bookingId, event_id: eventId, updated_at: new Date().toISOString() })
        }
      }
      if (newMappings.length) {
        const { error } = await admin.from('google_calendar_events').upsert(newMappings, { onConflict: 'owner_id,booking_id' })
        if (error) throw new Error('Se leyeron los eventos, pero no se pudieron guardar sus vínculos.')
      }
      const lastSyncedAt = new Date().toISOString()
      await admin.from('google_calendar_connections').update({ last_synced_at: lastSyncedAt, updated_at: lastSyncedAt }).eq('owner_id', ownerId)
      return json({ success: true, bookings, lastSyncedAt })
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
      .select('booking_id, event_id, payload_hash').eq('owner_id', ownerId)
    if (mappingError) throw new Error('No se pudo consultar la lista de eventos vinculados.')
    const eventByBookingId = new Map((existingEvents || []).map((row: { booking_id: string; event_id: string; payload_hash: string | null }) => [row.booking_id, row]))

    for (const booking of activeBookings as Record<string, unknown>[]) {
      if (!booking.date || !booking.time) continue
      const mapping = eventByBookingId.get(String(booking.id))
      const eventId = mapping?.event_id || String(booking.googleEventId || await googleEventId(String(booking.id)))
      const event = toGoogleEvent(booking, input.settings, eventId)
      const payloadHash = await hashEventPayload(event as unknown as Record<string, unknown>)
      if (mapping?.payload_hash === payloadHash) continue
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
        payload_hash: payloadHash,
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
