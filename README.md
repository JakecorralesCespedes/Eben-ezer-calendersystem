# Agenda Cancha

Primera versión web para administrar una cancha sintética de fútbol. Incluye sincronización en Supabase, autenticación del administrador, deuda individual por jugador y registro de abonos con montos libres.

## Iniciar

```bash
npm install
npm run dev
```

## Conectar la base permanente

1. Crear un proyecto en Supabase.
2. Copiar `.env.example` a `.env.local` y completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` desde el panel de Supabase.
3. Ejecutar el contenido de `database/schema.sql` una vez en el SQL Editor de Supabase.
4. Reiniciar `npm run dev`, crear el acceso del administrador y usar el mismo correo y contraseña en cada dispositivo.

En Supabase Auth, agregá el origen de la app en la lista de URL permitidas para que el enlace de confirmación regrese al teléfono o computadora correctos.

La clave `publishable` está hecha para usarse en el cliente con políticas RLS; nunca se debe poner la clave `service_role` en el navegador. Si el proyecto no está configurado, el modo de vista previa indica que los datos permanecen solo en el dispositivo.

La dirección local de Vite sirve únicamente dentro de la red Wi‑Fi. Para abrir el sistema desde cualquier lugar, también hay que publicar la app en un servicio de alojamiento web y cargar allí las mismas dos variables de Supabase.

## Incluye

- Agenda diaria y semanal de una cancha.
- Creación y edición de reservas, con detección de traslapes.
- Registro de pagos parciales y saldos pendientes.
- Resumen de cobros, clientes y reportes imprimibles.
- Vista sencilla para que un cliente consulte horarios y solicite una reserva.
- Exportación del calendario a `.ics`, compatible para importar en Google Calendar, Apple Calendar y Outlook.
- Ajustes iniciales para horario, moneda y precio base.

Los datos se guardan en el almacenamiento local del navegador. Esta versión todavía no sincroniza información entre dispositivos ni conecta cuentas externas de calendario. Los horarios, precios y flujos incluidos son supuestos iniciales y se ajustarán con las respuestas del dueño.
# Eben-ezer-calendersystem
