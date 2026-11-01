import { useState } from 'react';
import { Icon } from './components/Icon.jsx';

export default function CloudAccess({ onSignIn, onSignUp, error: setupError = '' }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(setupError);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    if (mode === 'signup') {
      const result = await onSignUp(email.trim(), password);
      if (result.error) setMessage('No se pudo crear el acceso. Revisá el correo y la contraseña e intentá de nuevo.');
      else if (result.needsEmailConfirmation) setMessage('Revisá tu correo y confirmá la cuenta antes de iniciar sesión.');
    } else {
      const error = await onSignIn(email.trim(), password);
      if (error) setMessage('Correo o contraseña incorrectos. Revisalos e intentá de nuevo.');
    }
    setBusy(false);
  }

  return <main className="access-page"><section className="access-card"><div className="access-brand"><span className="brand-mark"><Icon name="ball" size={22} /></span><span><b>Mi Cancha</b><small>AGENDA Y PAGOS</small></span></div><div className="access-heading"><span className="eyebrow">INFORMACIÓN SEGURA Y SINCRONIZADA</span><h1>{mode === 'signup' ? 'Crear acceso del administrador' : 'Iniciar sesión'}</h1><p>Usá el mismo correo y contraseña en cada dispositivo para ver los mismos datos.</p></div><form onSubmit={submit} className="access-form"><label className="field-label-input">Correo electrónico<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className="field-label-input">Contraseña<input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength="6" required /></label>{message && <div className="access-message">{message}</div>}<button className="button button-primary access-submit" disabled={busy}>{busy ? 'Conectando…' : mode === 'signup' ? 'Crear mi acceso' : 'Entrar a mi cancha'}</button></form><button className="access-toggle" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); }}>{mode === 'signin' ? 'Primera vez: crear cuenta de administrador' : 'Ya tengo acceso: iniciar sesión'}</button><div className="access-footnote">Al conectarte, la agenda queda guardada en la nube y sincronizada entre tus dispositivos.</div></section></main>;
}
