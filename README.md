# Agenda Cancha

App web para administrar una cancha sintética de fútbol. Incluye autenticación, sincronización entre dispositivos mediante Supabase, deuda individual por jugador y registro de pagos con montos exactos.

## Iniciar

```bash
npm install
npm run dev
```

## Base de datos permanente

1. Crear un proyecto en Supabase.
2. Ejecutar `database/schema.sql` en el SQL Editor de Supabase.
3. Crear la primera cuenta desde **Authentication → Users → Add user**. Si ya existía una cuenta, usá ese mismo correo.
4. Asignarle el rol de administrador desde el SQL Editor. Reemplazá el correo por el que acabás de crear. El usuario inicial será `admin`:

   ```sql
   insert into public.team_memberships (user_id, owner_id, username, email, display_name, role)
   select id, id, 'admin', lower(email), 'Administrador', 'admin'
   from auth.users
   where lower(email) = lower('TU_CORREO@EJEMPLO.COM')
   on conflict (user_id) do update
   set owner_id = excluded.owner_id,
       username = excluded.username,
       email = excluded.email,
       display_name = excluded.display_name,
       role = 'admin';
   ```

5. En Supabase **Authentication → Settings → User Signups**, apagá **Allow new users to sign up**. La aplicación no muestra registro público; el administrador agrega al personal desde **Accesos**.
6. Para desarrollo local, copiá `.env.example` a `.env.local`, completá `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`, y reiniciá `npm run dev`.

En Supabase Auth, agregá la URL pública de Render a `Site URL` y a las URL de redirección permitidas para que el enlace de confirmación regrese a la app.

Cada persona entra con su usuario o correo y contraseña. El administrador puede crear cuentas de personal, y cada persona puede cambiar su contraseña desde Ajustes. El botón **Salir** permite cambiar de cuenta. Clientes no tienen registro ni acceso a reservas o pagos internos. La configuración de Supabase bloquea también el registro directo de cuentas nuevas. [Desactivar registros en Supabase Auth](https://supabase.com/docs/guides/auth/general-configuration).

La app usa la clave `publishable` y políticas RLS. Las funciones de administración usan la clave secreta solo del lado del servidor; nunca la pongás en Render como variable `VITE_` ni en el navegador. Si no está configurada la nube, la app bloquea el acceso al área interna.

## Accesos del personal

Después de iniciar sesión como administrador, usá **Accesos → Agregar persona**. Completá el nombre, usuario, correo asociado y una contraseña temporal. La persona podrá ingresar con su usuario o correo, y cambiar la contraseña en Ajustes. **Quitar acceso** elimina su permiso de iniciar sesión y no borra las reservas del equipo.

Al administrador inicial se le asigna el rol una sola vez usando [database/bootstrap_admin.sql](database/bootstrap_admin.sql). Solo su cuenta puede abrir Accesos, crear cuentas de personal o revocar permisos. Las cuentas autorizadas ven la agenda y los pagos del mismo equipo en todos sus dispositivos.

Para habilitar la administración de cuentas, instalá y vinculá la CLI si aún no lo hiciste y desplegá las funciones de acceso:

```bash
npm install --save-dev supabase
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase functions deploy team-login
npx supabase functions deploy team-admin
```

## Conectar Google Calendar

Google Calendar se conecta desde **Ajustes → Conectar Google Calendar**. La integración usa una autorización de servidor: el secreto OAuth y el token de actualización se guardan en Supabase y nunca se envían al navegador. Render aloja la interfaz; Supabase ejecuta las funciones seguras que hablan con Google.

1. Ejecutá otra vez `database/schema.sql` en el SQL Editor de Supabase para crear las tablas privadas de conexión y eventos.
2. En Google Cloud Console, creá un proyecto, habilitá **Google Calendar API** y configurá la pantalla de consentimiento OAuth. Durante pruebas, agregá el correo dueño del calendario como usuario de prueba.
3. Creá una credencial OAuth de tipo **Aplicación web**. En **URI de redirección autorizados**, agregá exactamente `https://<project-ref>.supabase.co/functions/v1/google-calendar-callback`, reemplazando `<project-ref>` por el ID de tu proyecto Supabase.
4. Guardá el ID y secreto del cliente OAuth. En Supabase, abrí **Edge Functions → Secrets** y agregá `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` (la URL HTTPS de Render) y `GOOGLE_REDIRECT_URI` (la misma URL de callback del paso 3).
5. Desde esta carpeta, instalá/autenticá la CLI y vinculá el proyecto:

   ```bash
   npm install --save-dev supabase
   npx supabase login
   npx supabase link --project-ref TU_PROJECT_REF
   npx supabase functions deploy
   ```

6. Volvé a Render y desplegá la app. Iniciá sesión y conectá la cuenta de Google del calendario de la cancha desde Ajustes.

El primer permiso permite crear, actualizar y eliminar eventos de los calendarios que esa cuenta posee. Las reservas nuevas y editadas se sincronizan; las canceladas se quitan de Google Calendar. Al desconectar, se revoca el permiso y los eventos ya creados se conservan en Google.

Si la aplicación OAuth externa está en modo **Testing**, Google vence las autorizaciones de prueba a los 7 días para permisos de calendario. Para uso continuo hay que publicarla y, si Google lo solicita por el permiso sensible de calendario, completar su verificación. [Reglas oficiales de pruebas OAuth](https://support.google.com/cloud/answer/15549945?hl=es-419), [permisos de Calendar](https://developers.google.com/workspace/calendar/api/auth).

## Publicar en Render

El archivo `render.yaml` define un Static Site de Render, el comando `npm ci && npm run build`, la carpeta `dist`, una regla de reescritura para la app web y las variables de Supabase. Conectá el repositorio a Render como Blueprint; Render pedirá los valores de `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Vite los incorpora al compilar el sitio, así que guardá las variables en Render antes del despliegue y volvé a desplegar si las cambiás.

Render aloja la interfaz web y Supabase almacena los datos. La URL local de Vite es solo para desarrollo; la URL pública de Render permite abrir la app desde cualquier lugar.

## Incluye

- Agenda diaria y semanal de una cancha.
- Creación y edición de reservas, con detección de traslapes.
- Registro de pagos parciales y saldos pendientes.
- Resumen de cobros, clientes y reportes imprimibles.
- Vista sencilla para que un cliente consulte horarios y solicite una reserva.
- Exportación del calendario a `.ics`, compatible para importar en Google Calendar, Apple Calendar y Outlook.
- Ajustes iniciales para horario, moneda y precio base.

Los horarios, precios y flujos incluidos son supuestos iniciales y se ajustarán con las respuestas del dueño. La exportación `.ics` sigue disponible para importar reservas en Apple Calendar, Outlook u otras apps compatibles.
# Eben-ezer-calendersystem
