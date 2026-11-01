import { adminClient, corsHeaders, json, requireWorkspaceUser } from '../_shared/google.ts'

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const { user, membership, error: authError } = await requireWorkspaceUser(request)
  if (!user || !membership) return json({ error: authError }, 401)
  if (membership.role !== 'admin') return json({ error: 'Solo el administrador puede administrar las cuentas.' }, 403)

  try {
    const body = await request.json()
    const admin = adminClient()

    if (body?.action === 'list') {
      const { data: members, error } = await admin.from('team_memberships')
        .select('user_id, owner_id, username, email, display_name, role, created_at')
        .eq('owner_id', membership.owner_id).order('created_at', { ascending: true })
      if (error) throw new Error('No se pudo consultar la lista de accesos.')
      return json({ members: members || [] })
    }

    if (body?.action === 'create') {
      const displayName = String(body.displayName || '').trim()
      const username = String(body.username || '').trim().toLowerCase()
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      if (!displayName || displayName.length > 80) return json({ error: 'Escribí el nombre de la persona.' }, 400)
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json({ error: 'El usuario debe tener entre 3 y 32 letras, números, puntos, guiones o guiones bajos.' }, 400)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Escribí un correo válido.' }, 400)
      if (password.length < 8 || password.length > 72) return json({ error: 'La contraseña temporal debe tener entre 8 y 72 caracteres.' }, 400)

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName, username },
      })
      if (createError || !created.user) return json({ error: 'No se pudo crear la cuenta. Revisá que el correo no esté registrado.' }, 409)

      const { error: membershipError } = await admin.from('team_memberships').insert({
        user_id: created.user.id,
        owner_id: membership.owner_id,
        username,
        email,
        display_name: displayName,
        role: 'staff',
      })
      if (membershipError) {
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: membershipError.code === '23505' ? 'Ese usuario o correo ya está registrado.' : 'No se pudo asignar el acceso. No se creó la cuenta.' }, 409)
      }
      return json({ success: true })
    }

    if (body?.action === 'remove') {
      const userId = String(body.userId || '')
      if (!userId || userId === user.id) return json({ error: 'No podés quitar tu propio acceso de administrador.' }, 400)
      const { data: target, error: targetError } = await admin.from('team_memberships')
        .select('user_id, role').eq('user_id', userId).eq('owner_id', membership.owner_id).maybeSingle()
      if (targetError || !target) return json({ error: 'Esa cuenta no pertenece a este equipo.' }, 404)
      if (target.role === 'admin') return json({ error: 'No se puede quitar la cuenta del administrador principal.' }, 400)
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
      if (deleteError) return json({ error: 'No se pudo quitar el acceso. Intentá de nuevo.' }, 500)
      return json({ success: true })
    }

    return json({ error: 'Acción no reconocida.' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo administrar el acceso.' }, 500)
  }
})
