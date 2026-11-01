import { createClient } from 'npm:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function getSupabaseUrl() {
  const value = Deno.env.get('SUPABASE_URL')
  if (!value) throw new Error('Supabase no tiene configurada la URL del proyecto.')
  return value
}

function keyFromEnvironment(mapName: string, legacyName: string) {
  const rawMap = Deno.env.get(mapName)
  if (rawMap) {
    try {
      const keys = JSON.parse(rawMap)
      const defaultKey = keys.default || Object.values(keys)[0]
      if (typeof defaultKey === 'string') return defaultKey
    } catch { /* try the legacy key below */ }
  }
  return Deno.env.get(legacyName) || ''
}

export function adminClient() {
  const key = keyFromEnvironment('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!key) throw new Error('Supabase no tiene configurada la clave secreta del servidor.')
  return createClient(getSupabaseUrl(), key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export function publishableKey() {
  const key = keyFromEnvironment('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  if (!key) throw new Error('Supabase no tiene configurada la clave pública del proyecto.')
  return key
}

export async function requireUser(request: Request) {
  const authHeader = request.headers.get('Authorization') || ''
  const accessToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) return { user: null, error: 'Iniciá sesión para conectar Google Calendar.' }

  let key = ''
  try { key = publishableKey() } catch { return { user: null, error: 'Supabase no tiene una clave pública configurada para verificar la sesión.' } }
  const client = createClient(getSupabaseUrl(), key, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await client.auth.getUser(accessToken)
  if (error || !data.user) return { user: null, error: 'La sesión venció. Volvé a iniciar sesión e intentá de nuevo.' }
  return { user: data.user, error: '' }
}

export async function requireWorkspaceUser(request: Request) {
  const { user, error } = await requireUser(request)
  if (!user) return { user: null, membership: null, error }
  const { data: membership, error: membershipError } = await adminClient()
    .from('team_memberships')
    .select('owner_id, username, email, display_name, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (membershipError || !membership) return { user: null, membership: null, error: 'Esta cuenta no está habilitada para usar el programa.' }
  return { user, membership, error: '' }
}

export function redirectUri() {
  const configured = Deno.env.get('GOOGLE_REDIRECT_URI')
  if (configured) return configured
  return new URL('/functions/v1/google-calendar-callback', getSupabaseUrl()).toString()
}

export function appUrl() {
  const value = Deno.env.get('APP_URL')
  if (!value) throw new Error('Falta configurar APP_URL en los secretos de Supabase.')
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('APP_URL debe usar HTTPS.')
  return url.origin
}

export async function getConnection(ownerId: string) {
  const { data, error } = await adminClient()
    .from('google_calendar_connections')
    .select('owner_id, refresh_token, calendar_id, email, connected_at, last_synced_at')
    .eq('owner_id', ownerId)
    .maybeSingle()
  if (error) throw new Error('No se pudo consultar la conexión guardada de Google.')
  return data
}

export async function getGoogleAccessToken(ownerId: string) {
  const admin = adminClient()
  const { data: connection, error } = await admin
    .from('google_calendar_connections')
    .select('refresh_token')
    .eq('owner_id', ownerId)
    .maybeSingle()
  if (error || !connection?.refresh_token) throw new Error('Google Calendar no está conectado. Conectá la cuenta desde Ajustes.')

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Faltan las credenciales OAuth de Google en Supabase.')

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const tokens = await response.json()
  if (!response.ok || !tokens.access_token) {
    if (tokens.error === 'invalid_grant') throw new Error('La autorización de Google venció. Volvé a conectar Google Calendar desde Ajustes.')
    throw new Error('Google no pudo renovar la autorización. Volvé a conectar la cuenta desde Ajustes.')
  }
  return tokens.access_token as string
}

export async function googleApi(accessToken: string, url: string, method = 'GET', body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  if (text) {
    try { data = JSON.parse(text) } catch { /* error below will be generic */ }
  }
  return { response, data }
}

export async function googleEventId(bookingId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bookingId))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `ac${hex}`
}

function localDateTime(date: string, time: string, duration = 0) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute + duration))
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:00-06:00`
}

export function toGoogleEvent(booking: Record<string, unknown>, settings: Record<string, unknown>, eventId: string) {
  const status = booking.status === 'pending' ? 'Solicitud pendiente de confirmar' : booking.status === 'completed' ? 'Finalizada' : 'Confirmada'
  const description = [
    `Cancha: ${String(settings.businessName || 'Cancha sintética')}`,
    `Responsable o equipo: ${String(booking.name || '')}`,
    booking.phone ? `Teléfono: ${String(booking.phone)}` : '',
    `Estado: ${status}`,
    booking.notes ? `Notas: ${String(booking.notes)}` : '',
    'Evento sincronizado desde Agenda Cancha.',
  ].filter(Boolean).join('\n')
  return {
    id: eventId,
    summary: `${booking.status === 'pending' ? 'Pendiente · ' : ''}Fútbol · ${String(booking.name || 'Reserva')}`,
    description,
    location: String(settings.location || ''),
    start: { dateTime: localDateTime(String(booking.date), String(booking.time)), timeZone: 'America/Costa_Rica' },
    end: { dateTime: localDateTime(String(booking.date), String(booking.time), Number(booking.duration || 60)), timeZone: 'America/Costa_Rica' },
  }
}
