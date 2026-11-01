import { useEffect, useMemo, useState } from 'react';
import CloudAccess from './CloudAccess.jsx';
import { useCloudState } from './lib/cloudState.js';
import { supabase } from './lib/supabaseClient.js';
import { getCourtDue, getCourtPaid, getPlayerDebtTotal, getPlayerDue, getPlayerPaid, normalizeData } from './lib/appData.js';

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function localIso(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function money(amount, currency = 'CRC') {
  return new Intl.NumberFormat('es-CR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount || 0));
}

function formatDate(date, options = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('es-CR', options).format(date);
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatTime12(time) {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat('es-CR', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

function overlaps(a, b) {
  const startA = timeToMinutes(a.time);
  const endA = startA + Number(a.duration || 60);
  const startB = timeToMinutes(b.time);
  const endB = startB + Number(b.duration || 60);
  return startA < endB && startB < endA;
}

function Icon({ name, size = 19 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    wallet: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v16H5a2 2 0 0 1-2-2V6.5Z"/><path d="M3.5 7H20v5h-4a2 2 0 0 0 0 4h4"/><path d="M16 14.5h.01"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7-.2.1a7.8 7.8 0 0 1-1.4.8l-.2.1-.3 1.8h-2.8l-.3-1.8-.2-.1a7.8 7.8 0 0 1-1.4-.8l-.2-.1-1.7.7-1.4-2.4 1.4-1.1.1-.2a7.8 7.8 0 0 1 0-1.6l-.1-.2-1.4-1.1 1.4-2.4 1.7.7.2-.1a7.8 7.8 0 0 1 1.4-.8l.2-.1.3-1.8h2.8l.3 1.8.2.1a7.8 7.8 0 0 1 1.4.8l.2.1 1.7-.7 1.4 2.4-1.4 1.1-.1.2a7.8 7.8 0 0 1 0 1.6Z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    left: <><path d="m15 18-6-6 6-6"/></>,
    right: <><path d="m9 18 6-6-6-6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></>,
    external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></>,
    ball: <><circle cx="12" cy="12" r="9"/><path d="m12 8 3 2-1 4h-4l-1-4 3-2ZM12 8V3M8 10l-5-2M10 14l-3 5M14 14l3 5M15 10l5-2"/></>,
    dots: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    phone: <><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.8 2.1Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.ball}</svg>;
}

function getInitials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'MC';
}

function App() {
  const { data, setData, session, membership, membershipLoading, membershipError, authLoading, dataLoading, syncStatus, syncError, signIn, signOut, cloudConfigured: cloudActive } = useCloudState();
  const [view, setView] = useState('inicio');
  const [selectedDate, setSelectedDate] = useState(localIso());
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [googleCalendar, setGoogleCalendar] = useState({ loading: false, connected: false, email: '', lastSyncedAt: '', error: '' });
  const googleSyncSignature = useMemo(() => JSON.stringify({ bookings: data.bookings, settings: data.settings }), [data.bookings, data.settings]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const today = localIso();
  const bookings = data.bookings.filter((booking) => booking.status !== 'cancelled');
  const todayBookings = bookings.filter((booking) => booking.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const todayExpected = todayBookings.reduce((sum, booking) => sum + Number(booking.price || 0), 0);
  const todayPaid = todayBookings.reduce((sum, booking) => sum + getCourtPaid(booking), 0);
  const todayDue = todayBookings.reduce((sum, booking) => sum + getCourtDue(booking), 0);
  const clients = useMemo(() => {
    const map = new Map();
    data.bookings.forEach((booking) => {
      const key = `${booking.name.trim().toLowerCase()}|${booking.phone.trim()}`;
      if (!map.has(key)) map.set(key, { name: booking.name, phone: booking.phone, reservations: 0, due: 0, playerDue: 0, lastDate: booking.date });
      const client = map.get(key);
      client.reservations += 1;
      client.due += getCourtDue(booking);
      client.playerDue += getPlayerDebtTotal(booking);
      if (booking.date > client.lastDate) client.lastDate = booking.date;
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.bookings]);

  function notify(message) {
    setToast(message);
  }

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('google_calendar');
    if (!result) return;
    notify(result === 'connected' ? 'Google Calendar quedó conectado.' : result === 'denied' ? 'No se autorizó Google Calendar.' : 'No se pudo conectar Google Calendar. Revisá la configuración e intentá de nuevo.');
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (!cloudActive || !session?.user?.id || !membership?.owner_id || dataLoading) {
      setGoogleCalendar((current) => current.connected || current.loading ? { loading: false, connected: false, email: '', lastSyncedAt: '', error: '' } : current);
      return undefined;
    }
    let alive = true;
    setGoogleCalendar((current) => ({ ...current, loading: true, error: '' }));
    supabase.functions.invoke('google-calendar-sync', { body: { action: 'status' } }).then(({ data: result, error }) => {
      if (!alive) return;
      if (error) {
        setGoogleCalendar({ loading: false, connected: false, email: '', lastSyncedAt: '', error: 'No se pudo consultar la conexión de Google. Revisá que las funciones de Supabase estén desplegadas.' });
        return;
      }
      setGoogleCalendar({ loading: false, connected: Boolean(result?.connected), email: result?.email || '', lastSyncedAt: result?.lastSyncedAt || '', error: '' });
    });
    return () => { alive = false; };
  }, [cloudActive, session?.user?.id, membership?.owner_id, dataLoading]);

  useEffect(() => {
    if (!cloudActive || !session?.user?.id || !membership?.owner_id || dataLoading || !googleCalendar.connected) return undefined;
    const timer = setTimeout(async () => {
      const { error } = await supabase.functions.invoke('google-calendar-sync', {
        body: { action: 'sync', bookings: data.bookings, settings: data.settings },
      });
      if (error) setGoogleCalendar((current) => ({ ...current, error: 'Google Calendar no recibió los últimos cambios. Se intentará sincronizar otra vez al modificar la agenda.' }));
      else setGoogleCalendar((current) => ({ ...current, lastSyncedAt: new Date().toISOString(), error: '' }));
    }, 700);
    return () => clearTimeout(timer);
  }, [cloudActive, session?.user?.id, membership?.owner_id, dataLoading, googleCalendar.connected, googleSyncSignature]);

  async function connectGoogleCalendar() {
    if (!supabase) return notify('Primero conectá Supabase para guardar la autorización de Google de forma segura.');
    setGoogleCalendar((current) => ({ ...current, loading: true, error: '' }));
    const { data: result, error } = await supabase.functions.invoke('google-calendar-start', { body: {} });
    if (error || !result?.authorizationUrl) {
      setGoogleCalendar((current) => ({ ...current, loading: false, error: 'No se pudo iniciar la conexión. Verificá las funciones y secretos de Google en Supabase.' }));
      return;
    }
    window.location.assign(result.authorizationUrl);
  }

  async function disconnectGoogleCalendar() {
    const { error } = await supabase.functions.invoke('google-calendar-sync', { body: { action: 'disconnect' } });
    if (error) {
      setGoogleCalendar((current) => ({ ...current, error: 'No se pudo desconectar Google Calendar.' }));
      return;
    }
    setGoogleCalendar({ loading: false, connected: false, email: '', lastSyncedAt: '', error: '' });
    notify('Google Calendar desconectado. Los eventos ya creados permanecen en tu calendario.');
  }

  function saveBooking(values) {
    const conflict = data.bookings.some((booking) => booking.id !== values.id && booking.date === values.date && booking.status !== 'cancelled' && overlaps(booking, values));
    if (conflict) return { error: 'Ese horario ya está ocupado. Elegí otro espacio disponible.' };
    const existing = data.bookings.find((item) => item.id === values.id);
    const payments = existing?.payments || (Number(values.paid || 0) > 0 ? [{ id: `pay-${Date.now()}`, amount: Number(values.paid), method: values.method || 'Otro', playerId: null, createdAt: new Date().toISOString() }] : []);
    const booking = normalizeData({ bookings: [{
      ...values,
      players: (values.players || []).filter((player) => player.name.trim()).map((player) => ({ ...player, amountOwed: Number(player.amountOwed || 0), amountPaid: Number(player.amountPaid || 0) })),
      payments,
      price: Number(values.price),
      paid: existing ? getCourtPaid(existing) : Math.min(Number(values.paid || 0), Number(values.price)),
      createdAt: values.createdAt || new Date().toISOString(),
    }] }).bookings[0];
    setData((current) => ({ ...current, bookings: current.bookings.some((item) => item.id === booking.id)
      ? current.bookings.map((item) => item.id === booking.id ? booking : item)
      : [...current.bookings, booking] }));
    setModal(null);
    setSelectedDate(booking.date);
    notify(booking.status === 'pending' ? 'Solicitud de reserva recibida' : 'Reserva guardada');
    return { success: true };
  }

  function savePayment(id, amount, method, playerId = null) {
    setData((current) => ({ ...current, bookings: current.bookings.map((booking) => booking.id === id
      ? (() => {
          const player = booking.players.find((item) => item.id === playerId);
          const remaining = player ? getPlayerDue(booking, player) : getCourtDue(booking);
          const paymentAmount = Math.min(Number(amount), remaining);
          if (paymentAmount <= 0) return booking;
          const payment = { id: `pay-${Date.now()}`, amount: paymentAmount, method, playerId: playerId || null, createdAt: new Date().toISOString() };
          const next = { ...booking, payments: [...(booking.payments || []), payment], status: booking.status === 'pending' ? 'confirmed' : booking.status };
          if (!playerId) next.paid = Math.min(Number(booking.price), getCourtPaid(booking) + paymentAmount);
          else next.players = booking.players.map((item) => item.id === playerId ? { ...item, amountPaid: getPlayerPaid(booking, item) + paymentAmount } : item);
          return next;
        })()
      : booking) }));
    setModal(null);
    notify('Pago registrado correctamente');
  }

  function exportCalendar() {
    const events = bookings.filter((booking) => booking.status !== 'cancelled').map((booking) => {
      const start = `${booking.date.replaceAll('-', '')}T${booking.time.replace(':', '')}00`;
      const end = `${booking.date.replaceAll('-', '')}T${minutesToTime(timeToMinutes(booking.time) + Number(booking.duration)).replace(':', '')}00`;
      const escape = (text) => String(text || '').replaceAll('\\', '\\\\').replaceAll(',', '\\,').replaceAll(';', '\\;').replaceAll('\n', '\\n');
      return `BEGIN:VEVENT\r\nUID:${booking.id}@agenda-cancha.local\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}\r\nDTSTART;TZID=America/Costa_Rica:${start}\r\nDTEND;TZID=America/Costa_Rica:${end}\r\nSUMMARY:${escape(`Fútbol · ${booking.name}`)}\r\nDESCRIPTION:${escape(`Reserva de ${data.settings.businessName}. Estado: ${booking.status === 'pending' ? 'Pendiente' : 'Confirmada'}`)}\r\nEND:VEVENT`;
    }).join('\r\n');
    const content = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Agenda Cancha//ES\r\nCALSCALE:GREGORIAN\r\n${events}\r\nEND:VCALENDAR`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    link.download = 'agenda-cancha.ics';
    link.click();
    URL.revokeObjectURL(link.href);
    notify('Calendario descargado. Podés importarlo en Google, Apple o Outlook.');
  }

  async function changePassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return 'No se pudo cambiar la contraseña. Volvé a intentarlo.';
    notify('Contraseña actualizada.');
    return '';
  }

  if (!cloudActive) return <CloudAccess setupError="Esta versión necesita Supabase configurado para proteger los datos y validar los accesos. Configurá las variables de Supabase en Render y volvé a publicar." />;
  if (authLoading) return <LoadingScreen text="Conectando con la base de datos…" />;
  if (!session) return <CloudAccess onSignIn={signIn} />;
  if (membershipLoading) return <LoadingScreen text="Validando el acceso…" />;
  if (membershipError) return <AccessDenied message={membershipError === 'ACCOUNT_NOT_AUTHORIZED' ? 'Esta cuenta no está habilitada para usar el programa. Pedile al administrador que te agregue.' : membershipError} onSignOut={signOut} />;
  if (dataLoading) return <LoadingScreen text="Cargando reservas y pagos…" />;

  function changeView(next) {
    setView(next);
    setSearch('');
  }

  if (view === 'cliente') {
    return <CustomerPortal data={data} onBack={() => changeView('inicio')} onRequest={(date, time) => setModal({ type: 'booking', date, time, publicMode: true })} />;
  }

  const nav = [
    { id: 'inicio', label: 'Inicio', icon: 'grid' },
    { id: 'agenda', label: 'Agenda', icon: 'calendar' },
    { id: 'pagos', label: 'Pagos y deudas', icon: 'wallet', badge: data.bookings.filter((booking) => booking.status !== 'cancelled' && (getCourtDue(booking) > 0 || getPlayerDebtTotal(booking) > 0)).length },
    { id: 'clientes', label: 'Clientes', icon: 'users' },
    { id: 'ajustes', label: 'Ajustes', icon: 'settings' },
    ...(membership.role === 'admin' ? [{ id: 'usuarios', label: 'Accesos', icon: 'users' }] : []),
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Icon name="ball" size={23} /></div>
          <div><div className="brand-name">{data.settings.businessName}</div><div className="brand-subtitle">CONTROL DE CANCHA</div></div>
        </div>
        <div className="sidebar-caption">MENÚ PRINCIPAL</div>
        <nav className="main-nav" aria-label="Menú principal">
          {nav.map((item) => <button className={`nav-link ${view === item.id ? 'active' : ''}`} key={item.id} onClick={() => changeView(item.id)}>
            <Icon name={item.icon} /><span>{item.label}</span>{item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
          </button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="field-mini"><div className="field-mini-icon"><Icon name="ball" size={18} /></div><div><b>Cancha sintética</b><span>{data.settings.location}</span></div><i className="online-dot" /></div>
          <button className="side-help" onClick={() => setModal({ type: 'help' })}><span className="help-mark">?</span><span><b>¿Necesitás ayuda?</b><small>Guía rápida del sistema</small></span><Icon name="arrow" size={16} /></button>
          <div className="profile-mini"><div className="avatar avatar-owner">{getInitials(membership.display_name || membership.username)}</div><div><b>{membership.display_name || membership.username}</b><span>{membership.role === 'admin' ? 'Administrador' : 'Personal autorizado'}</span></div></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Cancha</span><span className="crumb-separator">/</span><b>{nav.find((item) => item.id === view)?.label}</b></div>
          <div className="topbar-actions">
            <button className="button button-quiet customer-view-button" onClick={() => changeView('cliente')}><Icon name="external" size={16} /> Vista cliente</button>
            <span className="topbar-divider" />
            <div className={`today-pill ${syncStatus === 'error' ? 'sync-error' : ''}`}><span className={`today-dot ${cloudActive ? syncStatus : 'local'}`} />{cloudActive ? ({ synced: 'Guardado en la nube', saving: 'Guardando…', loading: 'Sincronizando…', error: 'Error al guardar', checking: 'Conectando…', 'signed-out': 'Sin sesión' }[syncStatus] || 'Conectado') : 'Solo este dispositivo'}</div>
            {cloudActive && <button className="button button-quiet logout-button" onClick={signOut}>Salir</button>}
            <div className="avatar avatar-top" title={session.user.email}>{getInitials(membership.display_name || membership.username)}</div>
          </div>
        </header>
        {syncError && <div className="sync-error-banner"><b>Problema de sincronización:</b> {syncError}</div>}
        <div className="page-content">
          {view === 'inicio' && <Dashboard data={data} today={today} todayBookings={todayBookings} todayExpected={todayExpected} todayPaid={todayPaid} todayDue={todayDue} onNavigate={changeView} onNew={() => setModal({ type: 'booking' })} onBooking={(booking) => setModal({ type: 'booking', booking })} onPayment={(booking) => setModal({ type: 'payment', booking })} />}
          {view === 'agenda' && <Agenda data={data} selectedDate={selectedDate} onDate={setSelectedDate} onNew={(time) => setModal({ type: 'booking', date: selectedDate, time })} onBooking={(booking) => setModal({ type: 'booking', booking })} onExport={exportCalendar} />}
          {view === 'pagos' && <Payments data={data} search={search} setSearch={setSearch} onPayment={(booking) => setModal({ type: 'payment', booking })} onBooking={(booking) => setModal({ type: 'booking', booking })} />}
          {view === 'clientes' && <Clients clients={clients} search={search} setSearch={setSearch} data={data} />}
          {view === 'ajustes' && <Settings data={data} setData={setData} notify={notify} onExport={exportCalendar} cloudActive={cloudActive} syncError={syncError} googleCalendar={googleCalendar} onConnectGoogle={connectGoogleCalendar} onDisconnectGoogle={disconnectGoogleCalendar} membership={membership} accountEmail={session.user.email} onChangePassword={changePassword} />}
          {view === 'usuarios' && membership.role === 'admin' && <TeamManagement membership={membership} notify={notify} />}
        </div>
      </main>

      {modal?.type === 'booking' && <BookingModal data={data} booking={modal.booking} initialDate={modal.date} initialTime={modal.time} publicMode={modal.publicMode} onClose={() => setModal(null)} onSave={saveBooking} />}
      {modal?.type === 'payment' && <PaymentModal booking={modal.booking} currency={data.settings.currency} onClose={() => setModal(null)} onSave={savePayment} />}
      {modal?.type === 'help' && <HelpModal onClose={() => setModal(null)} />}
      {toast && <div className="toast"><span className="toast-check"><Icon name="check" size={15} /></span>{toast}</div>}
    </div>
  );
}

function Dashboard({ data, today, todayBookings, todayExpected, todayPaid, todayDue, onNavigate, onNew, onBooking, onPayment }) {
  const date = new Date(`${today}T12:00:00`);
  const open = Number(data.settings.openTime.slice(0, 2));
  const close = Number(data.settings.closeTime.slice(0, 2));
  const totalSlots = Math.max(0, close - open);
  const busyHours = todayBookings.reduce((sum, booking) => sum + Number(booking.duration || 60) / 60, 0);
  const usage = totalSlots ? Math.min(100, Math.round((busyHours / totalSlots) * 100)) : 0;
  const upcoming = todayBookings.find((booking) => booking.time >= new Date().toTimeString().slice(0, 5)) || todayBookings[0];

  return <>
    <div className="page-heading dashboard-heading">
      <div><div className="eyebrow">{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1>Buenos días <span className="heading-spark">✳</span></h1><p>Este es el resumen de tu cancha para hoy.</p></div>
      <button className="button button-primary" onClick={onNew}><Icon name="plus" size={18} /> Nueva reserva</button>
    </div>

    <section className="stats-grid">
      <StatCard icon="calendar" label="Partidos de hoy" value={todayBookings.length} note={todayBookings.length ? 'Reservas en la agenda' : 'Todavía no hay reservas'} tint="mint" />
      <StatCard icon="wallet" label="Por cobrar hoy" value={money(todayDue, data.settings.currency)} note={todayDue ? `${money(todayPaid, data.settings.currency)} recibidos de ${money(todayExpected, data.settings.currency)}` : 'Todo al día'} tint="sand" />
      <StatCard icon="clock" label="Uso de cancha" value={`${usage}%`} note={`${busyHours.toFixed(busyHours % 1 ? 1 : 0)} h reservadas hoy`} tint="lavender" />
      <StatCard icon="users" label="Próximo partido" value={upcoming ? formatTime12(upcoming.time) : '—'} note={upcoming?.name || 'Sin partidos próximos'} tint="peach" />
    </section>

    <div className="dashboard-grid">
      <section className="panel agenda-panel">
        <div className="panel-heading"><div><h2>Agenda de hoy</h2><p>{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><button className="text-link" onClick={() => onNavigate('agenda')}>Ver agenda <Icon name="arrow" size={15} /></button></div>
        {todayBookings.length ? <div className="today-booking-list">{todayBookings.map((booking, index) => <BookingRow key={booking.id} booking={booking} currency={data.settings.currency} index={index} onOpen={onBooking} onPayment={onPayment} />)}</div> : <EmptyState icon="calendar" title="Tu agenda está despejada" text="Cuando agregués una reserva, aparecerá aquí." action="Crear primera reserva" onClick={onNew} />}
        <div className="agenda-footer"><span className="legend-item"><i className="legend-dot confirmed" /> Confirmada</span><span className="legend-item"><i className="legend-dot pending" /> Pendiente</span><span className="agenda-footer-note">Los espacios libres se muestran en Agenda</span></div>
      </section>
      <div className="dashboard-side-column">
        <section className="panel collection-panel">
          <div className="panel-heading"><div><h2>Resumen de cobros</h2><p>Partidos de hoy</p></div><button className="round-icon-button" onClick={() => onNavigate('pagos')} aria-label="Ir a pagos"><Icon name="arrow" size={17} /></button></div>
          <div className="collection-total">{money(todayExpected, data.settings.currency)}</div><div className="collection-caption">Ingreso esperado</div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${todayExpected ? Math.min(100, Math.round(todayPaid / todayExpected * 100)) : 0}%` }} /></div>
          <div className="collection-breakdown"><span><i className="legend-dot paid" /> Recibido <b>{money(todayPaid, data.settings.currency)}</b></span><span><i className="legend-dot debt" /> Pendiente <b>{money(todayDue, data.settings.currency)}</b></span></div>
          {todayDue > 0 && <button className="collection-action" onClick={() => onNavigate('pagos')}>Revisar pagos pendientes <Icon name="arrow" size={15} /></button>}
        </section>
        <section className="field-card">
          <div className="field-card-top"><span className="field-label"><i className="online-dot" /> CANCHA EN SERVICIO</span><span className="field-card-icon"><Icon name="ball" size={20} /></span></div>
          <h3>{data.settings.businessName}</h3><p>{data.settings.location}</p>
          <div className="field-card-bottom"><div><span>Horario de hoy</span><b>{formatTime12(data.settings.openTime)} – {formatTime12(data.settings.closeTime)}</b></div><button aria-label="Editar ajustes" onClick={() => onNavigate('ajustes')}><Icon name="arrow" size={16} /></button></div>
        </section>
      </div>
    </div>
    <div className="dashboard-bottom-row"><div className="tip-icon">✦</div><div><b>Un consejo para empezar</b><p>Registrá los pagos después de cada partido para mantener al día la lista de pendientes.</p></div><button className="text-link" onClick={() => onNavigate('pagos')}>Ver pagos <Icon name="arrow" size={15} /></button></div>
  </>;
}

function StatCard({ icon, label, value, note, tint }) {
  return <div className="stat-card"><div className={`stat-icon ${tint}`}><Icon name={icon} size={19} /></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>;
}

function BookingRow({ booking, currency, index, onOpen, onPayment }) {
  const due = getCourtDue(booking);
  const playerDue = getPlayerDebtTotal(booking);
  return <div className="booking-row" onClick={() => onOpen(booking)} role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onOpen(booking)}>
    <div className="booking-time"><b>{formatTime12(booking.time)}</b><span>{Number(booking.duration) / 60} h</span></div>
    <div className="timeline-stem"><span className={`timeline-node ${booking.status}`} /></div>
    <div className="booking-main"><div className="booking-name-line"><b>{booking.name}</b><span className={`status-pill ${booking.status}`}>{booking.status === 'pending' ? 'Pendiente' : 'Confirmada'}</span></div><div className="booking-meta"><span><Icon name="phone" size={13} /> {booking.phone || 'Sin teléfono'}</span><span>{money(booking.price, currency)}</span></div></div>
    <div className="booking-row-action">{due > 0 || playerDue > 0 ? <button className="mini-pay-button" onClick={(event) => { event.stopPropagation(); onPayment(booking); }}>{due > 0 ? `Cobrar ${money(due, currency)}` : 'Ver deuda'}</button> : <span className="paid-check"><Icon name="check" size={15} /> Pagado</span>}<Icon name="right" size={17} /></div>
  </div>;
}

function Agenda({ data, selectedDate, onDate, onNew, onBooking, onExport }) {
  const date = new Date(`${selectedDate}T12:00:00`);
  const hours = [];
  const open = timeToMinutes(data.settings.openTime);
  const close = timeToMinutes(data.settings.closeTime);
  for (let mins = open; mins < close; mins += 60) hours.push(minutesToTime(mins));
  const dayBookings = data.bookings.filter((booking) => booking.date === selectedDate && booking.status !== 'cancelled').sort((a, b) => a.time.localeCompare(b.time));
  const days = Array.from({ length: 7 }, (_, index) => {
    const item = new Date(date);
    item.setDate(date.getDate() - ((date.getDay() + 6) % 7) + index);
    return item;
  });
  const busyAt = (time) => dayBookings.find((booking) => timeToMinutes(time) >= timeToMinutes(booking.time) && timeToMinutes(time) < timeToMinutes(booking.time) + booking.duration);
  const isToday = selectedDate === localIso();

  return <>
    <div className="page-heading"><div><div className="eyebrow">ORGANIZACIÓN DE PARTIDOS</div><h1>Agenda</h1><p>Revisá los horarios y organizá las reservas de tu cancha.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={onExport}><Icon name="download" size={17} /> Exportar calendario</button><button className="button button-primary" onClick={() => onNew()}><Icon name="plus" size={18} /> Nueva reserva</button></div></div>
    <section className="panel calendar-panel">
      <div className="calendar-toolbar"><div className="calendar-month"><button className="round-icon-button" aria-label="Día anterior" onClick={() => { const d = new Date(date); d.setDate(d.getDate() - 7); onDate(localIso(d)); }}><Icon name="left" size={17} /></button><h2>{MONTH_NAMES[date.getMonth()]} <span>{date.getFullYear()}</span></h2><button className="round-icon-button" aria-label="Semana siguiente" onClick={() => { const d = new Date(date); d.setDate(d.getDate() + 7); onDate(localIso(d)); }}><Icon name="right" size={17} /></button></div><button className={`button ${isToday ? 'button-soft' : 'button-secondary'}`} onClick={() => onDate(localIso())}>Hoy</button></div>
      <div className="week-strip">{days.map((day) => {
        const iso = localIso(day);
        const count = data.bookings.filter((booking) => booking.date === iso && booking.status !== 'cancelled').length;
        return <button key={iso} className={`week-day ${selectedDate === iso ? 'selected' : ''}`} onClick={() => onDate(iso)}><span>{DAY_NAMES[day.getDay()]}</span><b>{day.getDate()}</b><i className={count ? 'has-booking' : ''} /></button>;
      })}</div>
      <div className="selected-day-caption"><b>{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</b><span>{dayBookings.length} {dayBookings.length === 1 ? 'reserva' : 'reservas'}</span></div>
      <div className="schedule-list">{hours.map((time) => {
        const booking = busyAt(time);
        const startsAtThisHour = booking?.time === time;
        return <div className={`schedule-slot ${booking ? 'occupied' : ''}`} key={time}><div className="schedule-hour">{formatTime12(time)}</div><div className="schedule-slot-content">{booking ? startsAtThisHour ? <button className={`schedule-booking ${booking.status}`} onClick={() => onBooking(booking)}><span className="schedule-booking-bar" /><span className="schedule-booking-text"><b>{booking.name}</b><small>{formatTime12(booking.time)} · {Number(booking.duration) / 60} h · {booking.status === 'pending' ? 'Pendiente de confirmar' : 'Reserva confirmada'}</small></span><span className="schedule-booking-price">{money(booking.price, data.settings.currency)}</span><Icon name="right" size={16} /></button> : <div className="schedule-blocked"><span className="free-dot" /> Cancha ocupada hasta {formatTime12(minutesToTime(timeToMinutes(booking.time) + Number(booking.duration)))}</div> : <button className="schedule-free" onClick={() => onNew(time)}><span><i className="free-dot" /> Disponible</span><span className="schedule-add"><Icon name="plus" size={15} /> Reservar</span></button>}</div></div>;
      })}</div>
      <div className="calendar-legend"><span><i className="legend-dot confirmed" /> Confirmada</span><span><i className="legend-dot pending" /> Pendiente</span><span><i className="free-dot" /> Disponible</span></div>
    </section>
  </>;
}

function Payments({ data, search, setSearch, onPayment, onBooking }) {
  const [filter, setFilter] = useState('pendientes');
  const active = data.bookings.filter((booking) => booking.status !== 'cancelled');
  const hasDebt = (booking) => getCourtDue(booking) > 0 || getPlayerDebtTotal(booking) > 0;
  const filtered = active.filter((booking) => {
    const playerNames = booking.players.map((player) => player.name).join(' ');
    const matchesSearch = `${booking.name} ${booking.phone} ${playerNames}`.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'pendientes') return hasDebt(booking);
    if (filter === 'pagados') return !hasDebt(booking);
    return true;
  }).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const dueTotal = active.reduce((sum, booking) => sum + getCourtDue(booking), 0);
  const playerDueTotal = active.reduce((sum, booking) => sum + getPlayerDebtTotal(booking), 0);
  const playersInDebt = active.reduce((sum, booking) => sum + booking.players.filter((player) => getPlayerDue(booking, player) > 0).length, 0);
  const paidTotal = active.reduce((sum, booking) => sum + getCourtPaid(booking), 0);
  const expectedTotal = active.reduce((sum, booking) => sum + Number(booking.price || 0), 0);

  return <>
    <div className="page-heading"><div><div className="eyebrow">CONTROL DE INGRESOS</div><h1>Pagos y deudas</h1><p>Consultá cuánto falta de la cancha y qué jugadores deben su parte.</p></div><button className="button button-secondary" onClick={() => window.print()}><Icon name="download" size={17} /> Imprimir resumen</button></div>
    <section className="payment-summary-grid"><div className="payment-summary-card summary-dark"><span>Saldo de cancha</span><b>{money(dueTotal, data.settings.currency)}</b><small>Del precio de las reservas</small><span className="summary-orb"><Icon name="wallet" size={21} /></span></div><div className="payment-summary-card"><span>Deuda de jugadores</span><b>{money(playerDueTotal, data.settings.currency)}</b><small>{playersInDebt} {playersInDebt === 1 ? 'jugador debe' : 'jugadores deben'}</small><span className="summary-icon sand"><Icon name="users" size={19} /></span></div><div className="payment-summary-card"><span>Recibido por cancha</span><b>{money(paidTotal, data.settings.currency)}</b><small>Pagos registrados al negocio</small><span className="summary-icon mint"><Icon name="check" size={19} /></span></div><div className="payment-summary-card"><span>Total reservado</span><b>{money(expectedTotal, data.settings.currency)}</b><small>Valor de reservas activas</small><span className="summary-icon sand"><Icon name="calendar" size={18} /></span></div></section>
    <section className="panel table-panel"><div className="table-toolbar"><div className="filter-tabs"><button className={filter === 'pendientes' ? 'selected' : ''} onClick={() => setFilter('pendientes')}>Pendientes <span>{active.filter(hasDebt).length}</span></button><button className={filter === 'pagados' ? 'selected' : ''} onClick={() => setFilter('pagados')}>Al día</button><button className={filter === 'todos' ? 'selected' : ''} onClick={() => setFilter('todos')}>Todos</button></div><label className="search-box"><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar equipo o jugador..." /></label></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>CLIENTE / EQUIPO</th><th>FECHA Y HORA</th><th>TOTAL</th><th>PAGADO</th><th>SALDO</th><th>ESTADO</th><th></th></tr></thead><tbody>{filtered.map((booking) => {
        const due = getCourtDue(booking);
        const debtors = booking.players.filter((player) => getPlayerDue(booking, player) > 0);
        const owes = hasDebt(booking);
        return <tr key={booking.id}><td><button className="client-table-cell" onClick={() => onBooking(booking)}><span className={`avatar ${owes ? 'avatar-pending' : 'avatar-client'}`}>{getInitials(booking.name)}</span><span><b>{booking.name}</b><small>{booking.phone || 'Sin teléfono'}</small>{debtors.map((player) => <small className="debt-note" key={player.id}>{player.name} debe {money(getPlayerDue(booking, player), data.settings.currency)}{player.dueDate ? ` · prometió ${new Date(`${player.dueDate}T12:00:00`).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })}` : ''}</small>)}</span></button></td><td><b>{new Date(`${booking.date}T12:00:00`).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' })}</b><small className="table-subline">{formatTime12(booking.time)} · {booking.duration / 60} h</small></td><td>{money(booking.price, data.settings.currency)}</td><td>{money(getCourtPaid(booking), data.settings.currency)}</td><td><b className={due ? 'due-value' : ''}>{money(due, data.settings.currency)}</b></td><td><span className={`status-pill ${owes ? 'pending' : 'paid-status'}`}>{owes ? 'Pendiente' : 'Al día'}</span></td><td>{owes ? <button className="table-pay-button" onClick={() => onPayment(booking)}>Registrar pago</button> : <Icon name="check" size={17} />}</td></tr>;
      })}</tbody></table></div> : <EmptyState icon="wallet" title={filter === 'pendientes' ? 'No hay pagos pendientes' : 'No encontramos reservas'} text={filter === 'pendientes' ? '¡Todo está al día!' : 'Probá con otro filtro o término de búsqueda.'} />}
      <div className="table-footer">El saldo de cancha y las deudas personales de los jugadores se muestran por separado.</div>
    </section>
  </>;
}

function Clients({ clients, search, setSearch, data }) {
  const filtered = clients.filter((client) => `${client.name} ${client.phone}`.toLowerCase().includes(search.toLowerCase()));
  const totalDue = clients.reduce((sum, client) => sum + client.due, 0);
  const playerDue = clients.reduce((sum, client) => sum + client.playerDue, 0);
  return <>
    <div className="page-heading"><div><div className="eyebrow">CONTACTOS Y ACTIVIDAD</div><h1>Clientes</h1><p>Personas y equipos que han reservado la cancha.</p></div></div>
    <section className="client-overview"><div><span>Clientes registrados</span><b>{clients.length}</b></div><div><span>Saldo general de cancha</span><b className={totalDue ? 'due-value' : ''}>{money(totalDue, data.settings.currency)}</b></div><div><span>Deuda de jugadores</span><b className={playerDue ? 'due-value' : ''}>{money(playerDue, data.settings.currency)}</b></div><div className="client-overview-icon"><Icon name="users" size={23} /></div></section>
    <section className="panel table-panel clients-table-panel"><div className="table-toolbar"><div><h2>Lista de clientes</h2><p>Se crean al registrar una reserva.</p></div><label className="search-box"><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre o teléfono..." /></label></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>CLIENTE / EQUIPO</th><th>TELÉFONO</th><th>RESERVAS</th><th>ÚLTIMA RESERVA</th><th>SALDO CANCHA</th><th>DEUDA JUGADORES</th></tr></thead><tbody>{filtered.map((client) => <tr key={`${client.name}|${client.phone}`}><td><span className="client-table-cell"><span className="avatar avatar-client">{getInitials(client.name)}</span><span><b>{client.name}</b><small>Cliente de la cancha</small></span></span></td><td>{client.phone || '—'}</td><td>{client.reservations}</td><td>{new Date(`${client.lastDate}T12:00:00`).toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' })}</td><td><b className={client.due ? 'due-value' : ''}>{money(client.due, data.settings.currency)}</b></td><td><b className={client.playerDue ? 'due-value' : ''}>{money(client.playerDue, data.settings.currency)}</b></td></tr>)}</tbody></table></div> : <EmptyState icon="users" title="Todavía no hay clientes" text="Los contactos aparecerán aquí cuando registrés una reserva." />}
    </section>
  </>;
}

function Settings({ data, setData, notify, onExport, cloudActive, syncError, googleCalendar, onConnectGoogle, onDisconnectGoogle, membership, accountEmail, onChangePassword }) {
  const [form, setForm] = useState(data.settings);
  useEffect(() => setForm(data.settings), [data.settings]);
  function submit(event) {
    event.preventDefault();
    setData((current) => ({ ...current, settings: { ...form, hourlyRate: Number(form.hourlyRate), duration: Number(form.duration) } }));
    notify('Ajustes guardados');
  }
  return <>
    <div className="page-heading"><div><div className="eyebrow">CONFIGURACIÓN DEL NEGOCIO</div><h1>Ajustes</h1><p>Actualizá los datos y horarios de tu cancha.</p></div></div>
    <div className="settings-grid"><form className="panel settings-panel" onSubmit={submit}><div className="panel-heading"><div><h2>Datos de la cancha</h2><p>Se muestran en la agenda y en la vista de clientes.</p></div><span className="settings-icon"><Icon name="ball" size={20} /></span></div><div className="form-grid"><label className="field-label-input full">Nombre de la cancha<input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Ej. Cancha La Estrella" required /></label><label className="field-label-input full">Descripción o ubicación<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Ej. 200 m norte del parque" /></label><label className="field-label-input">Teléfono de contacto<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="8888-8888" /></label><label className="field-label-input">Moneda<select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option value="CRC">Colón costarricense (CRC)</option><option value="USD">Dólar estadounidense (USD)</option></select></label></div>
      <div className="settings-divider" /><div className="settings-subtitle">HORARIO Y PRECIO BASE</div><div className="form-grid"><label className="field-label-input">Abre a las<input type="time" value={form.openTime} onChange={(e) => setForm({ ...form, openTime: e.target.value })} required /><small className="field-help">{formatTime12(form.openTime)}</small></label><label className="field-label-input">Cierra a las<input type="time" value={form.closeTime} onChange={(e) => setForm({ ...form, closeTime: e.target.value })} required /><small className="field-help">{formatTime12(form.closeTime)}</small></label><label className="field-label-input">Precio por hora<input type="number" min="0" step="1" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} required /></label><label className="field-label-input">Duración sugerida<select value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}><option value="60">1 hora</option><option value="90">1 hora 30 min</option><option value="120">2 horas</option></select></label></div><div className="settings-actions"><span>{cloudActive ? 'Los cambios se sincronizan entre dispositivos.' : 'Cambios locales hasta conectar la base en la nube.'}</span><button className="button button-primary" type="submit">Guardar cambios</button></div></form>
      <div className="settings-side"><AccountAccessPanel membership={membership} accountEmail={accountEmail} onChangePassword={onChangePassword} /><section className="panel integration-panel"><div className="integration-icon"><Icon name="calendar" size={19} /></div><h3>Google Calendar</h3><p>Las reservas se copian a tu calendario principal. Los cambios de hora se actualizan y las reservas canceladas se quitan.</p>{googleCalendar.connected ? <div className="google-connection-state"><span className="online-dot" /><span><b>Conectado</b><small>{googleCalendar.email || 'Cuenta de Google'}{googleCalendar.lastSyncedAt ? ` · Sincronizado ${new Date(googleCalendar.lastSyncedAt).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</small></span></div> : <div className="integration-note"><span className="info-mark">i</span> {cloudActive ? googleCalendar.loading ? 'Consultando la conexión de Google…' : 'Conectá la cuenta de Google que usa el calendario de la cancha.' : 'Primero conectá Supabase para que la autorización pueda guardarse de forma segura en la nube.'}</div>}{googleCalendar.error && <div className="calendar-connect-error">{googleCalendar.error}</div>}<div className="calendar-connect-actions">{googleCalendar.connected ? membership.role === 'admin' && <button type="button" className="button button-secondary full-button" onClick={onDisconnectGoogle}>Desconectar Google</button> : membership.role === 'admin' && <button type="button" className="button button-primary full-button" onClick={onConnectGoogle} disabled={!cloudActive || googleCalendar.loading}>{googleCalendar.loading ? 'Conectando…' : 'Conectar Google Calendar'}</button>}<button type="button" className="button button-secondary full-button" onClick={onExport}><Icon name="download" size={16} /> Descargar .ics</button></div><div className="integration-note"><span className="info-mark">i</span> Apple Calendar y Outlook pueden importar el archivo .ics descargado.</div></section><section className={`storage-note ${cloudActive ? 'cloud-storage-note' : ''}`}><span className="storage-mark"><Icon name="settings" size={17} /></span><div><b>{cloudActive ? 'Base de datos en la nube conectada' : 'Falta conectar la base en la nube'}</b><p>{`Cuenta activa: ${accountEmail || membership.username}. Los cambios quedan sincronizados para el equipo.${syncError ? ` ${syncError}` : ''}`}</p></div></section></div></div>
  </>;
}

function AccountAccessPanel({ membership, accountEmail, onChangePassword }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (password.length < 8) return setMessage('Usá al menos 8 caracteres.');
    if (password !== confirmation) return setMessage('Las contraseñas no coinciden.');
    setBusy(true);
    setMessage('');
    const error = await onChangePassword(password);
    setMessage(error || 'Contraseña actualizada.');
    if (!error) { setPassword(''); setConfirmation(''); }
    setBusy(false);
  }
  return <section className="panel account-access-panel"><div className="panel-heading"><div><h2>Mi cuenta</h2><p>Entrás con este usuario o con su correo.</p></div><span className="settings-icon"><Icon name="users" size={19} /></span></div><dl className="account-details"><div><dt>Usuario</dt><dd>{membership.username}</dd></div><div><dt>Correo</dt><dd>{accountEmail || membership.email}</dd></div><div><dt>Permiso</dt><dd>{membership.role === 'admin' ? 'Administrador' : 'Personal autorizado'}</dd></div></dl><form className="password-change-form" onSubmit={submit}><label className="field-label-input">Nueva contraseña<input type="password" autoComplete="new-password" minLength="8" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label className="field-label-input">Repetí la contraseña<input type="password" autoComplete="new-password" minLength="8" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>{message && <small className="password-change-message">{message}</small>}<button type="submit" className="button button-secondary full-button" disabled={busy}>{busy ? 'Guardando…' : 'Cambiar contraseña'}</button></form></section>;
}

function TeamManagement({ membership, notify }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '' });

  async function loadMembers() {
    setLoading(true);
    const { data: result, error: invokeError } = await supabase.functions.invoke('team-admin', { body: { action: 'list' } });
    if (invokeError) setError('No se pudo cargar la lista. Revisá que team-admin esté desplegada en Supabase.');
    else { setMembers(result.members || []); setError(''); }
    setLoading(false);
  }
  useEffect(() => { loadMembers(); }, []);

  async function addMember(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { data: result, error: invokeError } = await supabase.functions.invoke('team-admin', {
      body: { action: 'create', ...form, username: form.username.trim().toLowerCase(), email: form.email.trim().toLowerCase() },
    });
    if (invokeError || result?.error) setError(result?.error || 'No se pudo crear la cuenta. Revisá que el usuario y correo no estén registrados.');
    else {
      setForm({ displayName: '', username: '', email: '', password: '' });
      notify('Cuenta creada. Compartí el usuario, correo y contraseña temporal con esa persona.');
      await loadMembers();
    }
    setBusy(false);
  }

  async function removeMember(member) {
    if (!window.confirm(`¿Querés quitar el acceso de ${member.display_name || member.username}?`)) return;
    setBusy(true);
    const { data: result, error: invokeError } = await supabase.functions.invoke('team-admin', { body: { action: 'remove', userId: member.user_id } });
    if (invokeError || result?.error) setError(result?.error || 'No se pudo quitar el acceso.');
    else { notify(`Se quitó el acceso de ${member.display_name || member.username}.`); await loadMembers(); }
    setBusy(false);
  }

  return <>
    <div className="page-heading"><div><div className="eyebrow">CUENTAS AUTORIZADAS</div><h1>Accesos del personal</h1><p>Solo el administrador puede agregar o quitar personas del programa.</p></div></div>
    <div className="team-management-grid"><form className="panel team-create-panel" onSubmit={addMember}><div className="panel-heading"><div><h2>Agregar persona</h2><p>Creá una cuenta para quien administra reservas o pagos.</p></div><span className="settings-icon"><Icon name="plus" size={19} /></span></div><div className="form-grid"><label className="field-label-input full">Nombre<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required autoComplete="name" /></label><label className="field-label-input full">Nombre de usuario<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} minLength="3" maxLength="32" pattern="[a-z0-9._-]{3,32}" required autoCapitalize="none" /><small className="field-help">También podrá entrar con su correo.</small></label><label className="field-label-input full">Correo asociado<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required autoComplete="email" /></label><label className="field-label-input full">Contraseña temporal<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength="8" required autoComplete="new-password" /><small className="field-help">La persona puede cambiarla en Ajustes después de entrar.</small></label></div>{error && <div className="calendar-connect-error">{error}</div>}<button type="submit" className="button button-primary full-button" disabled={busy}>{busy ? 'Guardando…' : 'Crear acceso'}</button><p className="team-password-note">Compartí la contraseña temporal directamente con la persona. No se envía por correo.</p></form>
      <section className="panel team-list-panel"><div className="panel-heading"><div><h2>Personas con acceso</h2><p>{members.length} cuentas del equipo</p></div><button type="button" className="round-icon-button" aria-label="Actualizar lista" onClick={loadMembers}><Icon name="right" size={16} /></button></div>{loading ? <div className="team-empty">Cargando cuentas…</div> : members.length ? <div className="team-member-list">{members.map((member) => <article className="team-member-row" key={member.user_id}><span className="avatar avatar-client">{getInitials(member.display_name || member.username)}</span><div className="team-member-info"><b>{member.display_name || member.username}</b><span>@{member.username} · {member.email}</span><small>{member.role === 'admin' ? 'Administrador' : 'Personal autorizado'}</small></div>{member.user_id !== membership.user_id && <button type="button" className="team-remove-button" onClick={() => removeMember(member)} disabled={busy}>Quitar acceso</button>}</article>)}</div> : <EmptyState icon="users" title="Todavía no agregás a nadie" text="Las cuentas nuevas aparecerán aquí." />}</section></div>
  </>;
}

function BookingModal({ data, booking, initialDate, initialTime, publicMode, onClose, onSave }) {
  const settings = data.settings;
  const [form, setForm] = useState(() => booking ? { ...booking, paid: getCourtPaid(booking), players: booking.players || [] } : {
    id: `booking-${Date.now()}`,
    date: initialDate || localIso(),
    time: initialTime || nextAvailableStart(data.bookings, initialDate || localIso(), settings),
    duration: Number(settings.duration),
    name: '', phone: '', notes: '', players: [], payments: [],
    price: Number(settings.hourlyRate) * (Number(settings.duration) / 60),
    paid: 0, method: '', status: publicMode ? 'pending' : 'confirmed',
  });
  const [error, setError] = useState('');
  const [customPrice, setCustomPrice] = useState(Boolean(booking));
  const availableTimes = useMemo(() => {
    const start = timeToMinutes(settings.openTime);
    const close = timeToMinutes(settings.closeTime);
    const times = [];
    for (let mins = start; mins + Number(form.duration) <= close; mins += 60) times.push(minutesToTime(mins));
    if (form.time && !times.includes(form.time)) times.push(form.time);
    return times.sort();
  }, [settings.openTime, settings.closeTime, form.duration, form.time]);
  const collisions = data.bookings.filter((item) => item.id !== form.id && item.date === form.date && item.status !== 'cancelled');

  function updateForm(patch) {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (!customPrice && (patch.duration || patch.date)) next.price = Number(settings.hourlyRate) * (Number(next.duration) / 60);
      return next;
    });
  }

  function updatePlayer(playerId, patch) {
    updateForm({ players: form.players.map((player) => player.id === playerId ? { ...player, ...patch } : player) });
  }

  function addPlayer() {
    updateForm({ players: [...form.players, { id: `player-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`, name: '', amountOwed: 0, amountPaid: 0, dueDate: '', note: '' }] });
  }

  function submit(event) {
    event.preventDefault();
    const result = onSave({ ...form, name: form.name.trim(), phone: form.phone.trim(), price: Number(form.price), paid: Number(form.paid || 0), players: (form.players || []).filter((player) => player.name.trim()) });
    if (result?.error) setError(result.error);
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-card booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title"><div className="modal-header"><div><span className="modal-kicker">{publicMode ? 'SOLICITUD DE RESERVA' : booking ? 'DETALLE DE RESERVA' : 'NUEVO PARTIDO'}</span><h2 id="booking-title">{publicMode ? 'Reservar cancha' : booking ? 'Reserva' : 'Nueva reserva'}</h2></div><button className="icon-button modal-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></div>
    {publicMode && <div className="public-info"><Icon name="check" size={17} /><span>Tu solicitud quedará pendiente hasta que la cancha la confirme.</span></div>}
    <form onSubmit={submit}>
      <div className="form-grid booking-basic-grid">
        <label className="field-label-input full">Nombre del equipo o responsable<input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} placeholder="Ej. Los Pinos FC" required autoFocus /></label>
        <label className="field-label-input full">Teléfono de contacto<input value={form.phone} onChange={(e) => updateForm({ phone: e.target.value })} placeholder="8888-8888" type="tel" required /></label>
        <label className="field-label-input">Fecha<input type="date" value={form.date} onChange={(e) => updateForm({ date: e.target.value })} required /></label>
        <label className="field-label-input">Hora<select value={form.time} onChange={(e) => updateForm({ time: e.target.value })} required>{availableTimes.map((time) => <option key={time} value={time} disabled={collisions.some((item) => overlaps(item, { ...form, time }))}>{formatTime12(time)}{collisions.some((item) => overlaps(item, { ...form, time })) ? ' · Ocupado' : ''}</option>)}</select></label>
        <label className="field-label-input">Duración<select value={form.duration} onChange={(e) => updateForm({ duration: Number(e.target.value) })}><option value="60">1 hora</option><option value="90">1 hora 30 min</option><option value="120">2 horas</option></select></label>
        {publicMode ? <div className="price-preview"><span>Precio estimado</span><b>{money(form.price, settings.currency)}</b></div> : <label className="field-label-input">Precio del partido<div className="money-input"><span>{settings.currency}</span><input type="number" min="0" step="1" value={form.price} onChange={(e) => { setCustomPrice(true); updateForm({ price: Number(e.target.value) }); }} required /></div></label>}
        {!publicMode && !booking && <label className="field-label-input">Pago recibido ahora<input type="number" min="0" max={form.price} step="1" value={form.paid} onChange={(e) => updateForm({ paid: Number(e.target.value) })} /></label>}
        {!publicMode && !booking && Number(form.paid) > 0 && <label className="field-label-input">Método de pago<select value={form.method} onChange={(e) => updateForm({ method: e.target.value })}><option value="">Elegir método</option><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label>}
      </div>
      {!publicMode && <details className="player-section" open={form.players.length > 0}><summary>Jugadores con saldo pendiente <span>{form.players.length}</span></summary><p>Anotá quién debe, cuánto debe y para cuándo prometió pagar.</p>{form.players.map((player) => <div className="player-entry" key={player.id}><div className="player-entry-top"><label className="field-label-input">Nombre del jugador<input value={player.name} onChange={(e) => updatePlayer(player.id, { name: e.target.value })} placeholder="Nombre" /></label><label className="field-label-input">Monto que debe<input type="number" min="0" step="1" value={player.amountOwed} onChange={(e) => updatePlayer(player.id, { amountOwed: Number(e.target.value) })} /></label><button type="button" className="remove-player" onClick={() => updateForm({ players: form.players.filter((item) => item.id !== player.id) })}>Quitar</button></div><div className="player-entry-bottom"><label className="field-label-input">Prometió pagar el<input type="date" value={player.dueDate || ''} onChange={(e) => updatePlayer(player.id, { dueDate: e.target.value })} /></label><label className="field-label-input">Nota (opcional)<input value={player.note || ''} onChange={(e) => updatePlayer(player.id, { note: e.target.value })} placeholder="Ej. después del partido" /></label></div></div>)}<button type="button" className="add-player-button" onClick={addPlayer}><Icon name="plus" size={17} /> Agregar jugador que debe</button></details>}
      {!publicMode && <label className="field-label-input booking-notes">Notas del partido (opcional)<textarea value={form.notes || ''} onChange={(e) => updateForm({ notes: e.target.value })} rows="2" placeholder="Información útil sobre este partido" /></label>}
      {error && <div className="form-error">{error}</div>}
      {!publicMode && booking && <div className="booking-management"><div><span>Estado</span><select value={form.status} onChange={(e) => updateForm({ status: e.target.value })}><option value="confirmed">Confirmada</option><option value="pending">Pendiente de confirmar</option><option value="completed">Finalizada</option><option value="cancelled">Cancelada</option></select></div><div className="balance-preview"><span>Saldo de cancha</span><b>{money(getCourtDue(booking), settings.currency)}</b></div></div>}
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button-primary">{publicMode ? 'Enviar solicitud' : booking ? 'Guardar cambios' : 'Guardar reserva'}</button></div>
    </form></section></div>;
}

function nextAvailableStart(bookings, date, settings) {
  const now = new Date();
  let mins = timeToMinutes(settings.openTime);
  const close = timeToMinutes(settings.closeTime);
  if (date === localIso()) mins = Math.max(mins, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 60) * 60);
  while (mins + Number(settings.duration) <= close) {
    const time = minutesToTime(mins);
    if (!bookings.some((booking) => booking.date === date && booking.status !== 'cancelled' && overlaps(booking, { time, duration: settings.duration }))) return time;
    mins += 60;
  }
  return settings.openTime;
}

function PaymentModal({ booking, currency, onClose, onSave }) {
  const debtors = booking.players.filter((player) => getPlayerDue(booking, player) > 0);
  const [payerId, setPayerId] = useState(() => debtors[0]?.id || 'court');
  const selectedPlayer = booking.players.find((player) => player.id === payerId);
  const balance = selectedPlayer ? getPlayerDue(booking, selectedPlayer) : getCourtDue(booking);
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState('Efectivo');
  useEffect(() => setAmount(balance), [payerId, booking.id]);
  const paymentHistory = [...(booking.payments || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-card payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title"><div className="modal-header"><div><span className="modal-kicker">REGISTRO DE COBRO</span><h2 id="payment-title">Registrar pago</h2></div><button className="icon-button modal-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></div><div className="payment-client-highlight"><div className="avatar avatar-client">{getInitials(booking.name)}</div><div><b>{booking.name}</b><span>{new Date(`${booking.date}T12:00:00`).toLocaleDateString('es-CR', { day: 'numeric', month: 'long' })} · {formatTime12(booking.time)}</span></div></div><div className="payment-balance-row"><span>Precio de la cancha</span><b>{money(booking.price, currency)}</b></div><div className="payment-balance-row"><span>Recibido por la cancha</span><b>{money(getCourtPaid(booking), currency)}</b></div><div className="payment-balance-row balance-due-row"><span>Saldo de cancha</span><b>{money(getCourtDue(booking), currency)}</b></div>{debtors.length > 0 && <div className="personal-debt-box"><b>Deuda personal de jugadores: {money(getPlayerDebtTotal(booking), currency)}</b><small>{debtors.map((player) => `${player.name}: ${money(getPlayerDue(booking, player), currency)}`).join(' · ')}</small></div>}{paymentHistory.length > 0 && <div className="payments-history"><b>Pagos registrados</b>{paymentHistory.map((payment) => { const player = booking.players.find((item) => item.id === payment.playerId); return <div className="payment-history-row" key={payment.id}><span><b>{player?.name || 'Pago de cancha'}</b><small>{payment.method || 'Otro'} · {new Date(payment.createdAt).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })}</small></span><strong>{money(payment.amount, currency)}</strong></div>; })}</div>}<form onSubmit={(event) => { event.preventDefault(); onSave(booking.id, amount, method, payerId === 'court' ? null : payerId); }}><div className="form-grid payment-form-grid"><label className="field-label-input full">¿Quién está pagando?<select value={payerId} onChange={(e) => setPayerId(e.target.value)}><option value="court">Pago general de la cancha</option>{debtors.map((player) => <option value={player.id} key={player.id}>{player.name} · debe {money(getPlayerDue(booking, player), currency)}</option>)}</select></label><p className="payment-mode-note full">{selectedPlayer ? 'Este abono reduce solo la deuda de este jugador.' : 'Este abono reduce el saldo general de la cancha.'}</p><label className="field-label-input">{selectedPlayer ? 'Monto que paga el jugador' : 'Monto recibido'}<input type="number" min="1" max={balance} step="1" value={amount} onChange={(e) => setAmount(Number(e.target.value))} required disabled={!balance} /></label><label className="field-label-input">Método<select value={method} onChange={(e) => setMethod(e.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button-primary" disabled={!balance || amount > balance}>Registrar {selectedPlayer ? 'pago del jugador' : 'pago de cancha'}</button></div></form></section></div>;
}

function CustomerPortal({ data, onBack, onRequest }) {
  const [date, setDate] = useState(localIso());
  const [selectedDuration, setSelectedDuration] = useState(Number(data.settings.duration));
  const day = new Date(`${date}T12:00:00`);
  const start = timeToMinutes(data.settings.openTime);
  const close = timeToMinutes(data.settings.closeTime);
  const slots = [];
  for (let mins = start; mins + selectedDuration <= close; mins += 60) {
    const time = minutesToTime(mins);
    const busy = data.bookings.some((booking) => booking.date === date && booking.status !== 'cancelled' && overlaps(booking, { time, duration: selectedDuration }));
    slots.push({ time, busy });
  }
  const availableCount = slots.filter((slot) => !slot.busy).length;
  return <div className="customer-portal"><header className="portal-header"><button className="portal-brand" onClick={onBack}><span className="brand-mark"><Icon name="ball" size={22} /></span><span><b>{data.settings.businessName}</b><small>CANCHA SINTÉTICA</small></span></button><button className="button button-quiet" onClick={onBack}><Icon name="left" size={16} /> Volver al administrador</button></header><main className="portal-content"><div className="portal-intro"><span className="portal-tag"><i className="online-dot" /> RESERVAS EN LÍNEA</span><h1>Encontrá tu próximo<br /><em>espacio de juego.</em></h1><p>Consultá los horarios disponibles y solicitá tu reserva en pocos pasos.</p><div className="portal-address"><Icon name="ball" size={17} /> {data.settings.location}</div></div><section className="portal-booking-panel"><div className="portal-panel-heading"><div><span className="eyebrow">DISPONIBILIDAD</span><h2>Elegí fecha y duración</h2></div><div className="available-counter"><b>{availableCount}</b><span>espacios<br />disponibles</span></div></div><div className="portal-controls"><label className="field-label-input">Fecha<input type="date" value={date} min={localIso()} onChange={(e) => setDate(e.target.value)} /></label><label className="field-label-input">Duración<select value={selectedDuration} onChange={(e) => setSelectedDuration(Number(e.target.value))}><option value="60">1 hora</option><option value="90">1 hora 30 min</option><option value="120">2 horas</option></select></label></div><div className="portal-slots-heading"><b>Horarios del {formatDate(day, { day: 'numeric', month: 'long' })}</b><span>Precio base: {money(Number(data.settings.hourlyRate) * selectedDuration / 60, data.settings.currency)}</span></div><div className="portal-slots">{slots.map(({ time, busy }) => <button key={time} disabled={busy} className={`portal-slot ${busy ? 'busy' : 'free'}`} onClick={() => onRequest(date, time)}><span>{formatTime12(time)}</span><small>{busy ? 'No disponible' : 'Disponible'}</small>{!busy && <Icon name="right" size={15} />}</button>)}</div><div className="portal-privacy-note"><span className="info-mark">i</span> Solo se muestra si un horario está disponible; los datos de otras reservas son privados.</div></section><footer className="portal-footer">¿Tenés dudas? Contactá a la cancha{data.settings.phone ? ` al ${data.settings.phone}` : ''}.</footer></main></div>;
}

function EmptyState({ icon, title, text, action, onClick }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={23} /></div><b>{title}</b><p>{text}</p>{action && <button className="button button-secondary" onClick={onClick}>{action}</button>}</div>;
}

function LoadingScreen({ text }) {
  return <main className="loading-page"><span className="loading-ball"><Icon name="ball" size={25} /></span><b>Mi Cancha</b><p>{text}</p></main>;
}

function AccessDenied({ message, onSignOut }) {
  return <main className="access-page"><section className="access-card"><div className="access-brand"><span className="brand-mark"><Icon name="ball" size={22} /></span><span><b>Mi Cancha</b><small>ACCESO ADMINISTRATIVO</small></span></div><div className="access-heading"><h1>Acceso no habilitado</h1><p>{message}</p></div><button type="button" className="button button-primary access-submit" onClick={onSignOut}>Volver al inicio</button></section></main>;
}

function HelpModal({ onClose }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-card help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="modal-header"><div><span className="modal-kicker">GUÍA RÁPIDA</span><h2 id="help-title">Lo esencial para empezar</h2></div><button className="icon-button modal-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></div><div className="help-steps"><div><span>1</span><p><b>Agendá el partido</b> desde “Nueva reserva”, con el nombre del equipo, teléfono y horario.</p></div><div><span>2</span><p><b>Registrá los pagos</b> al recibirlos. El saldo que falta queda visible en Pagos y deudas.</p></div><div><span>3</span><p><b>Revisá los horarios</b> desde Agenda. Los espacios libres también aparecen en la vista para clientes.</p></div></div><div className="help-local-note">Las reservas y los pagos se guardan en la nube para que el equipo vea la misma información en cada dispositivo.</div><div className="modal-actions"><button className="button button-primary" onClick={onClose}>Entendido</button></div></section></div>;
}

export default App;
