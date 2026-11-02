import { adminClient, corsHeaders, json, requireWorkspaceUser } from '../_shared/google.ts'

function minutes(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function overlaps(a: { time: string; duration: number }, b: { time: string; duration: number }) {
  return minutes(a.time) < minutes(b.time) + b.duration && minutes(b.time) < minutes(a.time) + a.duration
}

function todayInCostaRica() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

async function publicWorkspace() {
  const admin = adminClient()
  const { data: member, error: memberError } = await admin.from('team_memberships')
    .select('owner_id').eq('role', 'admin').limit(1).maybeSingle()
  if (memberError || !member?.owner_id) throw new Error('La cancha todavía no tiene un administrador configurado.')
  const [{ data: state, error: stateError }, { data: requests, error: requestError }] = await Promise.all([
    admin.from('app_state').select('data').eq('owner_id', member.owner_id).maybeSingle(),
    admin.from('booking_requests').select('booking_date, booking_time, duration').eq('owner_id', member.owner_id).eq('status', 'pending'),
  ])
  if (stateError || requestError) throw new Error('No se pudo consultar la disponibilidad.')
  const source = state?.data || {}
  const settings = source.settings || {}
  const safeSettings = {
    businessName: settings.businessName || 'Cancha sintética',
    location: settings.location || '',
    phone: settings.phone || '',
    openTime: settings.openTime || '08:00',
    closeTime: settings.closeTime || '22:00',
    hourlyRate: Number(settings.hourlyRate || 0),
    currency: settings.currency || 'CRC',
    duration: Number(settings.duration || 60),
  }
  const bookings = (Array.isArray(source.bookings) ? source.bookings : [])
    .filter((booking: Record<string, unknown>) => booking.status !== 'cancelled')
    .map((booking: Record<string, unknown>) => ({ date: booking.date, time: String(booking.time || '').slice(0, 5), duration: Number(booking.duration || 60) }))
  const pendingRequests = (requests || []).map((request: Record<string, unknown>) => ({
    date: request.booking_date,
    time: String(request.booking_time || '').slice(0, 5),
    duration: Number(request.duration || 60),
  }))
  return { admin, ownerId: member.owner_id, settings: safeSettings, bookings, pendingRequests }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  try {
    const input = await request.json().catch(() => ({}))
    const action = input?.action || 'availability'

    if (action === 'availability') {
      const workspace = await publicWorkspace()
      return json({ settings: workspace.settings, bookings: workspace.bookings, pendingRequests: workspace.pendingRequests, updatedAt: new Date().toISOString() })
    }

    if (action === 'request') {
      const booking = input?.booking || {}
      const name = String(booking.name || '').trim()
      const date = String(booking.date || '')
      const time = String(booking.time || '').slice(0, 5)
      const duration = Number(booking.duration || 60)
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || ![60, 90, 120].includes(duration)) {
        return json({ error: 'Revisá el nombre, la fecha, la hora y la duración.' }, 400)
      }
      const workspace = await publicWorkspace()
      if (date < todayInCostaRica()) return json({ error: 'Elegí una fecha futura.' }, 400)
      if (minutes(time) < minutes(workspace.settings.openTime) || minutes(time) + duration > minutes(workspace.settings.closeTime)) {
        return json({ error: 'Ese horario queda fuera del horario de la cancha.' }, 400)
      }
      const candidate = { time, duration }
      const conflict = [...workspace.bookings, ...workspace.pendingRequests].some((item) => item.date === date && overlaps(candidate, { time: item.time, duration: item.duration }))
      if (conflict) return json({ error: 'Ese horario acaba de ocuparse. Actualizá la disponibilidad y elegí otro.' }, 409)
      const { data: requestId, error } = await workspace.admin.rpc('submit_public_booking_request', {
        p_owner_id: workspace.ownerId,
        p_name: name,
        p_phone: String(booking.phone || '').trim(),
        p_date: date,
        p_time: time,
        p_duration: duration,
      })
      if (error?.message?.includes('SLOT_BUSY')) return json({ error: 'Ese horario acaba de ocuparse. Actualizá la disponibilidad y elegí otro.' }, 409)
      if (error) throw new Error('No se pudo guardar la solicitud. Ejecutá la versión actualizada de database/schema.sql.')
      return json({ success: true, requestId })
    }

    const { membership, error: authError } = await requireWorkspaceUser(request)
    if (!membership) return json({ error: authError }, 401)
    if (membership.role !== 'admin') return json({ error: 'Solo el administrador puede revisar las solicitudes.' }, 403)
    const admin = adminClient()

    if (action === 'list-requests') {
      const { data, error } = await admin.from('booking_requests').select('*').eq('owner_id', membership.owner_id).eq('status', 'pending').order('created_at')
      if (error) throw new Error('No se pudieron cargar las solicitudes. Ejecutá la versión actualizada de database/schema.sql.')
      return json({ requests: data || [] })
    }

    if (action === 'resolve-request') {
      const requestId = String(input.requestId || '')
      const decision = input.decision
      if (!requestId || !['accept', 'reject'].includes(decision)) return json({ error: 'Falta indicar la solicitud y qué hacer con ella.' }, 400)
      const { data: row, error: requestError } = await admin.from('booking_requests').select('*')
        .eq('id', requestId).eq('owner_id', membership.owner_id).eq('status', 'pending').maybeSingle()
      if (requestError || !row) return json({ error: 'La solicitud ya no está pendiente. Actualizá la lista.' }, 404)

      if (decision === 'accept') {
        const { data: state, error: stateError } = await admin.from('app_state').select('data').eq('owner_id', membership.owner_id).maybeSingle()
        if (stateError || !state?.data) throw new Error('No se pudo abrir la agenda de la cancha.')
        const current = state.data as Record<string, unknown>
        const settings = (current.settings || {}) as Record<string, unknown>
        const bookings = Array.isArray(current.bookings) ? current.bookings as Record<string, unknown>[] : []
        const candidate = { time: String(row.booking_time).slice(0, 5), duration: Number(row.duration) }
        const conflict = bookings.some((booking) => booking.date === row.booking_date && booking.status !== 'cancelled' && overlaps(candidate, { time: String(booking.time).slice(0, 5), duration: Number(booking.duration || 60) }))
        if (conflict) return json({ error: 'Ese horario se ocupó mientras la solicitud esperaba. Rechazala o contactá al cliente para ofrecerle otro horario.' }, 409)
        const booking = {
          id: `request-${row.id}`,
          date: row.booking_date,
          time: candidate.time,
          duration: candidate.duration,
          name: row.name,
          phone: row.phone || '',
          notes: 'Solicitud recibida desde el portal de clientes.',
          players: [],
          payments: [],
          price: Math.round(Number(settings.hourlyRate || 0) * candidate.duration / 60),
          paid: 0,
          status: 'pending',
          category: 'unclassified',
          matchup: 'both_teams',
          createdAt: row.created_at,
        }
        const { error: saveError } = await admin.from('app_state').update({
          data: { ...current, bookings: [...bookings, booking] },
          updated_at: new Date().toISOString(),
        }).eq('owner_id', membership.owner_id)
        if (saveError) throw new Error('No se pudo agregar la solicitud a la agenda.')
      }
      const { error } = await admin.from('booking_requests').update({ status: decision === 'accept' ? 'accepted' : 'rejected' })
        .eq('id', requestId).eq('owner_id', membership.owner_id)
      if (error) throw new Error('La decisión se guardó, pero no se pudo actualizar la solicitud.')
      return json({ success: true })
    }

    return json({ error: 'Acción no reconocida.' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo completar la consulta.' }, 500)
  }
})
