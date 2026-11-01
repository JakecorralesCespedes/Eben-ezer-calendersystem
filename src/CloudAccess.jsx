import { useState } from 'react';
import { Icon } from './components/Icon.jsx';

export default function CloudAccess({ onSignIn, error: setupError = '' }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(setupError);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const error = await onSignIn(identifier.trim(), password);
    if (error) setMessage(error === 'ACCOUNT_NOT_AUTHORIZED'
      ? 'Esta cuenta todavía no tiene permiso. Pedile al administrador que habilite el acceso.'
      : 'Usuario, correo o contraseña incorrectos. Revisalos e intentá de nuevo.');
    setBusy(false);
  }

  if (setupError) return <main className="access-page"><section className="access-card"><div className="access-brand"><span className="brand-mark"><Icon name="ball" size={22} /></span><span><b>Mi Cancha</b><small>AGENDA Y PAGOS</small></span></div><div className="access-heading"><span className="eyebrow">ACCESO ADMINISTRATIVO</span><h1>Falta conectar la nube</h1><p>{setupError}</p></div></section></main>;

  return <main className="access-page"><section className="access-card"><div className="access-brand"><span className="brand-mark"><Icon name="ball" size={22} /></span><span><b>Mi Cancha</b><small>AGENDA Y PAGOS</small></span></div><div className="access-heading"><span className="eyebrow">ACCESO SOLO PARA PERSONAL AUTORIZADO</span><h1>Iniciar sesión</h1><p>Entrá con tu nombre de usuario o con el correo asociado a tu cuenta.</p></div><form onSubmit={submit} className="access-form"><label className="field-label-input">Usuario o correo<input autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required autoCapitalize="none" /></label><label className="field-label-input">Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{message && <div className="access-message">{message}</div>}<button className="button button-primary access-submit" disabled={busy}>{busy ? 'Ingresando…' : 'Entrar'}</button></form><div className="access-footnote">El administrador crea y habilita todas las cuentas. Si no tenés acceso, contactá a la persona encargada.</div></section></main>;
}
