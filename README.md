# Agenda Cancha

App web para administrar una cancha sintética de fútbol. Incluye autenticación, sincronización entre dispositivos mediante Supabase, deuda individual por jugador y registro de pagos con montos exactos.

## Iniciar

```bash
npm install
npm run dev
```

## Base de datos permanente

1. Crear un proyecto en Supabase.
2. Ejecutar `database/schema.sql` una vez en el SQL Editor de Supabase.
3. Para desarrollo local, copiar `.env.example` a `.env.local` y completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` desde el panel de Supabase.
4. Reiniciar `npm run dev`, crear el acceso del administrador y usar el mismo correo y contraseña en cada dispositivo.

En Supabase Auth, agregá la URL pública de Render a `Site URL` y a las URL de redirección permitidas para que el enlace de confirmación regrese a la app.

La app usa la clave `publishable` del cliente y políticas RLS. Nunca pongás la clave `service_role` en el navegador. Si la conexión de Supabase aún no está configurada, el modo de vista previa indica que los datos permanecen solo en ese dispositivo.

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

Los horarios, precios y flujos incluidos son supuestos iniciales y se ajustarán con las respuestas del dueño. La conexión automática con Google Calendar todavía requiere autorización OAuth; por ahora se ofrece un enlace para crear un evento en Google y exportación `.ics` para otras apps de calendario.
# Eben-ezer-calendersystem
