import { adminClient, appUrl, redirectUri } from '../_shared/google.ts'

function redirectToApp(result: string) {
  const url = new URL(appUrl())
  url.searchParams.set('google_calendar', result)
  return Response.redirect(url, 303)
}

Deno.serve(async (request: Request) => {
  const requestUrl = new URL(request.url)
  const state = requestUrl.searchParams.get('state') || ''
  const code = requestUrl.searchParams.get('code') || ''
  const providerError = requestUrl.searchParams.get('error')

  try {
    const app = adminClient()
    let ownerId = ''
    if (state) {
      const { data: savedState, error } = await app.from('google_calendar_oauth_states')
        .delete().eq('state', state).select('owner_id, expires_at').maybeSingle()
      if (error || !savedState || new Date(savedState.expires_at).getTime() < Date.now()) return redirectToApp('error')
      ownerId = savedState.owner_id
    }
    if (!ownerId) return redirectToApp('error')
    if (providerError || !code) return redirectToApp('denied')

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    if (!clientId || !clientSecret) return redirectToApp('error')
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenResponse.json()
    if (!tokenResponse.ok || !tokens.access_token) return redirectToApp('error')

    let email = ''
    const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (identityResponse.ok) {
      const identity = await identityResponse.json()
      email = String(identity.email || '')
    }
    const { data: existing } = await app.from('google_calendar_connections').select('refresh_token').eq('owner_id', ownerId).maybeSingle()
    const refreshToken = tokens.refresh_token || existing?.refresh_token
    if (!refreshToken) return redirectToApp('error')

    const { error } = await app.from('google_calendar_connections').upsert({
      owner_id: ownerId,
      refresh_token: refreshToken,
      calendar_id: 'primary',
      email,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id' })
    if (error) return redirectToApp('error')
    return redirectToApp('connected')
  } catch {
    try { return redirectToApp('error') } catch { return new Response('La conexión de Google no pudo finalizar. Revisá APP_URL en los secretos de Supabase.', { status: 500 }) }
  }
})
