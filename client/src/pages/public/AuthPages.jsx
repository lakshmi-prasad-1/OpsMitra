import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/Auth.jsx';
import { api } from '../../lib/api.js';
import { useDocumentTitle } from '../../lib/hooks.js';
import { Button, Field } from '../../components/ui.jsx';

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <Link to="/" className="auth-back"><ArrowLeft size={16} /> Back to home</Link>
      <div className="auth-card">
        <Link to="/" className="auth-logo" aria-label="OpsMitra home"><img src="/opsmitra-logo.png" alt="OpsMitra" /></Link>
        <h1>{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
      <p className="auth-bottom">OpsMitra · Your Business, Simplified by AI</p>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, placeholder = 'At least 8 characters', ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-field">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} minLength={8} maxLength={72} placeholder={placeholder} required {...rest} />
      <button type="button" className="icon-btn" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
    </div>
  );
}

function strength(pw) {
  let score = 0;
  if (pw.length >= 8) score++; if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++; if (/\d/.test(pw)) score++; if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, Math.max(pw ? 1 : 0, score - 1));
}
const STRENGTH = ['', 'Weak', 'Fair', 'Good', 'Strong'];

function DemoButton({ onError, next }) {
  const { demo } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try { await demo(); navigate(next && next.startsWith('/app') ? next : '/app', { replace: true }); } catch (e) { onError?.(e.message); setBusy(false); }
  };
  return <Button variant="secondary" className="btn-block" icon={Sparkles} loading={busy} onClick={start}>Try the live demo — no sign-up</Button>;
}

export function Login() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sp] = useSearchParams();
  const next = sp.get('next');
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(location.state?.expired ? 'Please sign in to continue.' : '');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(form.email, form.password); navigate(next && next.startsWith('/app') ? next : '/app', { replace: true }); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your inventory, sales and orders." footer={<>New to OpsMitra? <Link to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="link">Create an account</Link></>}>
      <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
        <Field label="Email address">{p => <input {...p} type="email" required autoComplete="email" maxLength={190} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@business.com" />}</Field>
        <Field label="Password">{p => <PasswordInput {...p} value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} autoComplete="current-password" placeholder="Your password" />}</Field>
        <div style={{ textAlign: 'right', marginTop: -6 }}><Link to="/forgot-password" className="link" style={{ fontSize: 14 }}>Forgot password?</Link></div>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <Button type="submit" size="lg" className="btn-block" loading={busy}>Sign in</Button>
        <div className="divider"><span>or</span></div>
        <DemoButton onError={setError} next={next} />
      </form>
    </AuthShell>
  );
}

export function Register() {
  useDocumentTitle('Create account');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next');
  const [form, setForm] = useState({ name: '', businessName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = key => value => setForm(f => ({ ...f, [key]: value }));
  const score = strength(form.password);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await register(form); navigate(next && next.startsWith('/app') ? next : '/app', { replace: true }); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <AuthShell title="Create your workspace" subtitle="Start organising your business operations in one place." footer={<>Already have an account? <Link to="/login" className="link">Sign in</Link></>}>
      <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
        <Field label="Your name" required>{p => <input {...p} required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={e => set('name')(e.target.value)} placeholder="e.g. Asha Raman" />}</Field>
        <Field label="Business name" hint="Shown on your invoices. You can change it later.">{p => <input {...p} maxLength={160} autoComplete="organization" value={form.businessName} onChange={e => set('businessName')(e.target.value)} placeholder="e.g. Sri Lakshmi Provisions" />}</Field>
        <Field label="Email address" required>{p => <input {...p} type="email" required maxLength={190} autoComplete="email" value={form.email} onChange={e => set('email')(e.target.value)} placeholder="you@business.com" />}</Field>
        <Field label="Password" required>{p => <PasswordInput {...p} value={form.password} onChange={set('password')} autoComplete="new-password" />}</Field>
        {form.password && <div className="strength" aria-live="polite"><div className="strength-bars">{[1, 2, 3, 4].map(n => <i key={n} className={n <= score ? `on s${score}` : ''} />)}</div><span>{STRENGTH[score]}</span></div>}
        {error && <div className="inline-error" role="alert">{error}</div>}
        <Button type="submit" size="lg" className="btn-block" loading={busy}>Create workspace</Button>
        <div className="divider"><span>or</span></div>
        <DemoButton onError={setError} />
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  useDocumentTitle('Reset password');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { setResult(await api.post('/auth/forgot-password', { email })); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Reset your password" subtitle="Enter your account email and we'll prepare a reset link." footer={<Link to="/login" className="link">Back to sign in</Link>}>
      {result ? (
        <div className="stack" style={{ gap: 14 }}>
          <div className="inline-note"><Check size={16} style={{ verticalAlign: -3 }} /> {result.message}</div>
          {result.resetLink && (
            <div className="callout"><KeyRound size={18} /><div><strong>Prototype shortcut</strong><p style={{ margin: '4px 0 8px' }}>{result.prototypeNotice}</p><a className="link" href={new URL(result.resetLink).pathname}>Open your reset link →</a></div></div>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
          <Field label="Email address">{p => <input {...p} type="email" required maxLength={190} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@business.com" autoComplete="email" />}</Field>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <Button type="submit" size="lg" className="btn-block" loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  useDocumentTitle('Choose a new password');
  const { token } = useParams();
  const navigate = useNavigate();
  const [pw, setPw] = useState(''); const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState(false);
  const submit = async e => {
    e.preventDefault(); setError('');
    if (pw !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try { await api.post('/auth/reset-password', { token, password: pw }); setDone(true); setTimeout(() => navigate('/login', { replace: true }), 2000); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <AuthShell title="Choose a new password" subtitle={done ? undefined : 'Pick something strong that you have not used elsewhere.'} footer={<Link to="/login" className="link">Back to sign in</Link>}>
      {done ? <div className="inline-note"><Check size={16} style={{ verticalAlign: -3 }} /> Password updated. Taking you to sign in…</div> : (
        <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
          <Field label="New password">{p => <PasswordInput {...p} value={pw} onChange={setPw} autoComplete="new-password" />}</Field>
          <Field label="Confirm new password">{p => <PasswordInput {...p} value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Repeat the password" />}</Field>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <Button type="submit" size="lg" className="btn-block" loading={busy}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
