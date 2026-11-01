import { createClient } from 'npm:@supabase/supabase-js@2'
import { adminClient, corsHeaders, getSupabaseUrl, json, publishableKey } from '../_shared/google.ts'

const invalidLogin = () => json({ error: 'Usuario, correo o contraseña incorrectos.' }, 401)

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  try {
    const body = await request.json()
    const identifier = String(body?.username || '').trim().toLowerCase()
    const password = String(body?.password || '')
    if (!identifier || !password || password.length > 256) return invalidLogin()

    const admin = adminClient()
    const column = identifier.includes('@') ? 'email' : 'username'
    const { data: member, error } = await admin.from('team_memberships')
      .select('email').eq(column, identifier).maybeSingle()
    if (error || !member?.email) return invalidLogin()

    const authClient = createClient(getSupabaseUrl(), publishableKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error: authError } = await authClient.auth.signInWithPassword({ email: member.email, password })
    if (authError || !data.session) return invalidLogin()
    return json({ session: data.session })
  } catch {
    return invalidLogin()
  }
})
