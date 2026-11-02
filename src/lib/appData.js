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
      femaleOwnerName: 'Dueña de la cancha',
      maleOwnerName: 'Dueño de la cancha',
    },
    bookings: [],
    recurringRules: [],
  };
}

export function normalizeBooking(booking) {
  const payments = Array.isArray(booking.payments) ? booking.payments : Number(booking.paid || 0) > 0
    ? [{ id: `legacy-${booking.id}`, amount: Number(booking.paid), method: booking.method || 'Otro', playerId: null, createdAt: booking.createdAt || new Date().toISOString() }]
    : [];
  return {
    ...booking,
    phone: booking.phone || '',
    category: booking.category || 'unclassified',
    matchup: booking.matchup || 'both_teams',
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
    recurringRules: Array.isArray(data.recurringRules) ? data.recurringRules : [],
  };
}

export function materializeRecurringBookings(value, fromDate = new Date()) {
  const data = normalizeData(value);
  if (!data.recurringRules.length) return data;
  const today = new Date(fromDate);
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 365);
  horizon.setHours(12, 0, 0, 0);
  const existing = new Set(data.bookings.map((booking) => booking.id));
  const additions = [];
  for (const rule of data.recurringRules) {
    const ruleStart = new Date(`${rule.startDate}T12:00:00`);
    const end = rule.endDate ? new Date(`${rule.endDate}T12:00:00`) : horizon;
    if (end < today) continue;
    const cursor = ruleStart < today ? new Date(today) : ruleStart;
    cursor.setHours(12, 0, 0, 0);
    const finalDate = end < horizon ? end : horizon;
    while (cursor <= finalDate) {
      if (cursor.getDay() === Number(rule.weekday)) {
        const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        const id = `${rule.id}-${date}`;
        const [ruleHour, ruleMinute] = String(rule.booking.time).split(':').map(Number);
        const ruleStart = ruleHour * 60 + ruleMinute;
        const duration = Number(rule.booking.duration || 60);
        const occupied = data.bookings.some((booking) => {
          if (booking.date !== date || booking.status === 'cancelled') return false;
          const [hour, minute] = String(booking.time).split(':').map(Number);
          const start = hour * 60 + minute;
          return ruleStart < start + Number(booking.duration || 60) && start < ruleStart + duration;
        });
        if (!existing.has(id) && !occupied) {
          additions.push(normalizeBooking({
            ...rule.booking,
            id,
            date,
            recurrenceRuleId: rule.id,
            createdAt: new Date().toISOString(),
          }));
          existing.add(id);
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return additions.length ? { ...data, bookings: [...data.bookings, ...additions] } : data;
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
