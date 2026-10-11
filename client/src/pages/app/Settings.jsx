import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAction, useApi, useDocumentTitle } from '../../lib/hooks.js';
import { useAuth } from '../../context/Auth.jsx';
import { useTheme } from '../../context/Theme.jsx';
import { useConfirm } from '../../context/Toast.jsx';
import { dateLabel } from '../../lib/format.js';
import { Badge, Button, DefinitionList, Field, PageHeader, Panel } from '../../components/ui.jsx';

export default function Settings() {
  useDocumentTitle('Settings');
  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, business details, security and preferences." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {[['profile', 'Profile'], ['business', 'Business & invoices'], ['security', 'Security'], ['appearance', 'Appearance'], ['about', 'About & data']].map(([to, label]) => <NavLink key={to} to={`/app/settings/${to}`} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>)}
        </nav>
        <div>
          <Routes>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfileSection />} />
            <Route path="business" element={<BusinessSection />} />
            <Route path="security" element={<SecuritySection />} />
            <Route path="appearance" element={<AppearanceSection />} />
            <Route path="about" element={<AboutSection />} />
            <Route path="*" element={<Navigate to="profile" replace />} />
          </Routes>
        </div>
      </div>
    </>
  );
}

function useProfileSave(success) {
  const { setUser } = useAuth();
  return useAction(body => api.patch('/auth/profile', body), { success, silentError: true, onSuccess: r => setUser(r.user) });
}

function ProfileSection() {
  const { user } = useAuth();
  const [name, setName] = useState(user.name);
  const [error, setError] = useState('');
  const save = useProfileSave('Profile updated.');
  return (
    <Panel title="Profile" subtitle="How you appear in OpsMitra">
      <form onSubmit={e => { e.preventDefault(); setError(''); save.mutate({ name }, { onError: err => setError(err.message) }); }} className="stack" style={{ gap: 16, maxWidth: 480 }}>
        <Field label="Your name">{p => <input {...p} required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} />}</Field>
        <Field label="Email address" hint="Your sign-in email can't be changed in this prototype.">{p => <input {...p} value={user.email} disabled />}</Field>
        <DefinitionList items={[['Member since', dateLabel(user.createdAt)], ['Workspace', user.isDemo ? <Badge tone="amber">Demo</Badge> : <Badge tone="green" dot>Active</Badge>]]} />
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div><Button type="submit" loading={save.isPending} disabled={name.trim() === user.name}>Save changes</Button></div>
      </form>
    </Panel>
  );
}

function BusinessSection() {
  const { user } = useAuth();
  const make = () => ({ businessName: user.businessName || '', businessType: user.businessType || '', businessPhone: user.businessPhone || '', businessAddress: user.businessAddress || '', gstin: user.gstin || '' });
  const [form, setForm] = useState(make);
  const [error, setError] = useState(null);
  useEffect(() => setForm(make()), [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useProfileSave('Business details saved.');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const err = f => (error?.field === f ? error.message : undefined);
  return (
    <Panel title="Business & invoices" subtitle="These details are printed on every invoice">
      <form onSubmit={e => { e.preventDefault(); setError(null); save.mutate(form, { onError: setError }); }}>
        <div className="form-grid" style={{ maxWidth: 760 }}>
          <Field label="Business name" className="span-2">{p => <input {...p} maxLength={160} value={form.businessName} onChange={set('businessName')} placeholder="e.g. Sri Lakshmi Provisions" />}</Field>
          <Field label="Business type">{p => <input {...p} list="biz-types" maxLength={80} value={form.businessType} onChange={set('businessType')} placeholder="e.g. Retail / Kirana" /> }</Field>
          <datalist id="biz-types">{['Retail / Kirana', 'Wholesale', 'Restaurant / Café', 'Pharmacy', 'Clothing', 'Electronics', 'Services'].map(t => <option key={t} value={t} />)}</datalist>
          <Field label="Phone">{p => <input {...p} type="tel" maxLength={32} value={form.businessPhone} onChange={set('businessPhone')} />}</Field>
          <Field label="GSTIN" error={err('gstin')} hint="15 characters. Leave blank if not GST-registered.">{p => <input {...p} maxLength={15} value={form.gstin} onChange={set('gstin')} style={{ textTransform: 'uppercase' }} placeholder="33ABCDE1234F1Z5" />}</Field>
          <Field label="Address" className="span-2">{p => <textarea {...p} rows={2} maxLength={300} value={form.businessAddress} onChange={set('businessAddress')} />}</Field>
        </div>
        {error && !error.field && <div className="inline-error" role="alert" style={{ marginTop: 16 }}>{error.message}</div>}
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}><Button type="submit" loading={save.isPending}>Save business details</Button></div>
      </form>
    </Panel>
  );
}

function SecuritySection() {
  const { user, logoutEverywhere } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState(null);
  const change = useAction(() => api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword }), { success: 'Password changed. Other devices were signed out.', silentError: true, onSuccess: () => setForm({ currentPassword: '', newPassword: '', confirm: '' }) });
  const submit = e => {
    e.preventDefault(); setError(null);
    if (form.newPassword !== form.confirm) { setError({ message: 'The new passwords do not match.', field: 'confirm' }); return; }
    change.mutate(undefined, { onError: setError });
  };
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const err = f => (error?.field === f ? error.message : undefined);
  return (
    <div className="stack">
      <Panel title="Change password" subtitle="You'll stay signed in here; other devices are signed out">
        {user.isDemo ? <p className="muted">Demo workspaces don&apos;t have a password.</p> : (
          <form onSubmit={submit} className="stack" style={{ gap: 16, maxWidth: 420 }}>
            <Field label="Current password" error={err('currentPassword')}>{p => <input {...p} type="password" required autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} />}</Field>
            <Field label="New password" error={err('newPassword')} hint="At least 8 characters">{p => <input {...p} type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} />}</Field>
            <Field label="Confirm new password" error={err('confirm')}>{p => <input {...p} type="password" required autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />}</Field>
            {error && !error.field && <div className="inline-error" role="alert">{error.message}</div>}
            <div><Button type="submit" loading={change.isPending}>Update password</Button></div>
          </form>
        )}
      </Panel>
      <Panel title="Sessions" subtitle="Sign out of OpsMitra on every device, including this one">
        <p className="muted" style={{ marginBottom: 14 }}>Use this if you lost a device or used a shared computer. Sessions use secure HttpOnly cookies and expire automatically after 8 hours.</p>
        <Button variant="danger" icon={LogOut} onClick={async () => { if (await confirm({ title: 'Sign out everywhere?', message: 'Every signed-in device, including this one, will need to sign in again.', confirmLabel: 'Sign out everywhere', tone: 'danger' })) { await logoutEverywhere(); navigate('/login', { replace: true }); } }}>Sign out of all devices</Button>
      </Panel>
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <Panel title="Appearance" subtitle="Saved on this device">
      <div className="theme-options" style={{ maxWidth: 480 }}>
        {[['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'Match device', Monitor]].map(([key, label, Icon]) => <button key={key} className={theme === key ? 'active' : ''} aria-pressed={theme === key} onClick={() => setTheme(key)}><Icon size={22} />{label}</button>)}
      </div>
    </Panel>
  );
}

function AboutSection() {
  const { user } = useAuth();
  const assistant = useApi(['assistant', 'status'], '/assistant/status');
  const health = useApi(['health'], '/health');
  return (
    <div className="stack">
      <Panel title="System status">
        <DefinitionList items={[
          ['Server', health.isPending ? 'Checking…' : health.data?.status === 'ok' ? <Badge tone="green" dot>Healthy</Badge> : <Badge tone="red" dot>Needs attention</Badge>],
          ['Data integrity', health.data?.integrity === 'ok' ? <Badge tone="green" dot>Verified</Badge> : '—'],
          ['Assistant', assistant.data?.mode === 'claude' ? <Badge tone="green" dot>Claude ({assistant.data.model})</Badge> : <Badge tone="gray" dot>Built-in</Badge>],
          ['Storage', 'SQLite, scoped to your account']
        ]} />
      </Panel>
      <Panel title="About this prototype">
        <p className="muted">OpsMitra is an AI-assisted business operations prototype. Insights are rule-based and explain their evidence, forecasts are statistical estimates, and the assistant can only read your data. There is no payment gateway, e-invoicing or supplier sync. {user.isDemo ? 'You are in a demo workspace with sample data.' : ''}</p>
      </Panel>
    </div>
  );
}
