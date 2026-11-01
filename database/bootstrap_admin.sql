-- First create this user in Supabase Dashboard > Authentication > Users > Add user.
-- Replace the email and username below, then run this file in the Supabase SQL Editor.
insert into public.team_memberships (user_id, owner_id, username, email, display_name, role)
select id, id, 'Maye', lower(email), 'Administrador', 'Mayela'
from auth.users
where lower(email) = lower('mayelacespedes69@gmail.com')
on conflict (user_id) do update
set owner_id = excluded.owner_id,
    username = excluded.username,
    email = excluded.email,
    display_name = excluded.display_name,
    role = 'admin';
