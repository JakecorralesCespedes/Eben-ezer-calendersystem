export const STORAGE_KEY = 'agenda-cancha-v1';

export function makeInitialData() {
  return {
    settings: {
      businessName: 'Mi Cancha',
      location: 'Cancha sintética de fútbol',
      phone: '',
      openTime: '08:00',
      closeTime: '22:00',
      hourlyRate: 25000,
      currency: 'CRC',
      duration: 60,
    },
    bookings: [],
  };
}

export function normalizeBooking(booking) {
  const payments = Array.isArray(booking.payments) ? booking.payments : Number(booking.paid || 0) > 0
    ? [{ id: `legacy-${booking.id}`, amount: Number(booking.paid), method: booking.method || 'Otro', playerId: null, createdAt: booking.createdAt || new Date().toISOString() }]
    : [];
  return {
    ...booking,
    payments,
    paid: Number.isFinite(Number(booking.paid)) ? Number(booking.paid) : payments.filter((payment) => !payment.playerId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    players: Array.isArray(booking.players) ? booking.players.map((player, index) => ({
      id: player.id || `player-${booking.id}-${index}`,
      name: player.name || '',
      amountOwed: Number(player.amountOwed || 0),
      amountPaid: Number(player.amountPaid || 0),
      dueDate: player.dueDate || '',
      note: player.note || '',
    })) : [],
  };
}

export function normalizeData(value) {
  const initial = makeInitialData();
  const data = value && typeof value === 'object' ? value : {};
  return {
    ...initial,
    ...data,
    settings: { ...initial.settings, ...(data.settings || {}) },
    bookings: Array.isArray(data.bookings) ? data.bookings.map(normalizeBooking) : [],
  };
}

export function readLocalData() {
  try {
    return normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return makeInitialData();
  }
}

export function getCourtPaid(booking) {
  if (Number.isFinite(Number(booking.paid))) return Math.max(0, Number(booking.paid));
  return (booking.payments || []).filter((payment) => !payment.playerId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

export function getCourtDue(booking) {
  return Math.max(0, Number(booking.price || 0) - getCourtPaid(booking));
}

export function getPlayerPaid(booking, player) {
  const payments = (booking.payments || []).filter((payment) => payment.playerId === player.id);
  return payments.length ? payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) : Number(player.amountPaid || 0);
}

export function getPlayerDue(booking, player) {
  return Math.max(0, Number(player.amountOwed || 0) - getPlayerPaid(booking, player));
}

export function getPlayerDebtTotal(booking) {
  return (booking.players || []).reduce((sum, player) => sum + getPlayerDue(booking, player), 0);
}
