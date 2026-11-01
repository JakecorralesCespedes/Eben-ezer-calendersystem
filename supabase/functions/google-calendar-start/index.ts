import { adminClient, corsHeaders, json, requireWorkspaceUser, redirectUri } from '../_shared/google.ts'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const { membership, error: authError } = await requireWorkspaceUser(request)
  if (!membership) return json({ error: authError }, 401)
  if (membership.role !== 'admin') return json({ error: 'Solo el administrador puede conectar Google Calendar.' }, 403)

  try {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
    if (!clientId) return json({ error: 'Falta configurar GOOGLE_CLIENT_ID en Supabase.' }, 500)
    const state = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const { error } = await adminClient().from('google_calendar_oauth_states').insert({
      state,
      owner_id: membership.owner_id,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })
    if (error) throw new Error('No se pudo preparar la autorización de Google. Ejecutá la actualización de database/schema.sql.')

    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authorization.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/calendar.events.owned',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
    }).toString()
    return json({ authorizationUrl: authorization.toString() })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo iniciar Google Calendar.' }, 500)
  }
})
