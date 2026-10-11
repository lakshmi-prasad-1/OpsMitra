import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, Bell, BrainCircuit, Check, ClipboardList, FileText, Menu, MessageSquare, Package, Receipt, ShieldCheck, Sparkles, Truck, Users, X } from 'lucide-react';
import { useAuth } from '../../context/Auth.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';
import { Button } from '../../components/ui.jsx';

const FEATURES = [
  [Package, 'Know your stock', 'Live quantities, low-stock and expiry alerts, a full stock ledger and suggested reorder quantities.'],
  [Receipt, 'Bill in seconds', 'A fast point-of-sale with discounts, GST, UPI/cash/card and printable invoices.'],
  [ClipboardList, 'Run your orders', 'Track every order from pending to delivered. Completing one updates stock and sales automatically.'],
  [Users, 'Keep customers close', 'Purchase history, lifetime value and credit balances, with payments recorded in one tap.'],
  [BarChart3, 'See your profit', 'Revenue, margin, GST and best sellers over any period, with CSV and print-ready reports.'],
  [BrainCircuit, 'Get plain-language advice', 'Explainable insights and an assistant that answers “what should I restock?” from your own data.']
];
const FAQ = [
  ['Is the AI making things up?', 'No. Insights come from clear rules over your recorded sales and stock, and every one shows the numbers behind it. Forecasts are labelled as statistical estimates. The assistant can only read your data through fixed, read-only queries.'],
  ['Do I need to install anything?', 'No. OpsMitra runs in your browser on phone, tablet or computer.'],
  ['Can I try it without signing up?', 'Yes. “Try the live demo” opens a private workspace with 90 days of realistic sample data that you can reset any time.'],
  ['Is my data separate from other businesses?', 'Yes. Every record belongs to one account and every query is scoped to it, with sessions held in secure HttpOnly cookies.'],
  ['What does it cost?', 'OpsMitra is a prototype today and free to explore. Subscription plans for small businesses will be shaped with early users.']
];

export default function Landing() {
  useDocumentTitle('');
  const { user, demo } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tryDemo = async () => {
    setBusy(true); setError('');
    try { await demo(); navigate('/app'); } catch (e) { setError(e.message); setBusy(false); }
  };
  const cta = user
    ? <Button as={Link} to="/app" icon={ArrowRight}>Open dashboard</Button>
    : <><Button as={Link} to="/login" variant="ghost">Sign in</Button><Button as={Link} to="/register">Get started</Button></>;

  return (
    <div className="site">
      <header className="site-header">
        <div className="wrap site-header-inner">
          <Link to="/" className="brand-link"><img src="/opsmitra-logo.png" alt="" /><span>OpsMitra</span></Link>
          <nav className={`site-nav ${menu ? 'open' : ''}`} onClick={() => setMenu(false)}>
            <a href="#features">Features</a><a href="#ai">AI &amp; insights</a><a href="#how">How it works</a><a href="#faq">FAQ</a>
            <div className="site-nav-cta-mobile">{cta}</div>
          </nav>
          <div className="site-cta">{cta}</div>
          <button className="icon-btn site-menu" aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu(m => !m)}>{menu ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </header>

      <main>
        <section className="hero wrap">
          <div className="hero-copy">
            <div className="pill"><Sparkles size={14} /> Business operations, made simple</div>
            <h1>Less paperwork.<br /><span>More progress.</span></h1>
            <p>OpsMitra brings your stock, billing, orders, customers and reports into one simple workspace — and tells you in plain language what needs your attention.</p>
            <div className="hero-actions">
              <Button size="lg" icon={Sparkles} onClick={tryDemo} loading={busy}>Try the live demo</Button>
              <Button as={Link} to="/register" size="lg" variant="secondary">Create free workspace <ArrowRight size={16} /></Button>
            </div>
            {error && <div className="inline-error" style={{ marginTop: 14 }} role="alert">{error}</div>}
            <ul className="hero-points"><li><Check size={16} /> No sign-up needed for the demo</li><li><Check size={16} /> Works on phone and desktop</li><li><Check size={16} /> Made for Indian small businesses · ₹ · GST</li></ul>
          </div>
          <HeroPreview />
        </section>

        <section className="strip"><div className="wrap strip-inner">
          <span>One workspace for</span><b><Package size={16} /> Inventory</b><b><Receipt size={16} /> Billing</b><b><ClipboardList size={16} /> Orders</b><b><Users size={16} /> Customers</b><b><BarChart3 size={16} /> Reports</b><b><BrainCircuit size={16} /> Insights</b>
        </div></section>

        <section id="features" className="section wrap">
          <div className="section-head"><div className="eyebrow">Everything in order</div><h2>Everything you run, <span>in one place</span></h2><p>Replace the notebook, the calculator and three spreadsheets with one connected system.</p></div>
          <div className="feature-grid">
            {FEATURES.map(([Icon, title, text]) => <article className="feature" key={title}><span className="feature-icon"><Icon size={22} /></span><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </section>

        <section id="ai" className="section band">
          <div className="wrap ai-layout">
            <div>
              <div className="eyebrow">AI you can check</div>
              <h2>Advice that shows its working</h2>
              <p className="lead">Every recommendation comes with the evidence behind it — no black boxes, no invented numbers.</p>
              <ul className="ticks">
                <li><Check size={18} /><span><b>Restock alerts</b> that estimate days of stock left and how much to order.</span></li>
                <li><Check size={18} /><span><b>Credit tracking</b> that flags who owes you and for how long.</span></li>
                <li><Check size={18} /><span><b>Margin and expiry watch</b> so slow or thin-margin items never surprise you.</span></li>
                <li><Check size={18} /><span><b>Ask in plain words</b> — “who owes me money?” or “how were sales this week?”</span></li>
              </ul>
            </div>
            <div className="ai-demo" aria-hidden="true">
              <div className="chat-mock user">What should I restock this week?</div>
              <div className="chat-mock bot"><b>Restock soon (3)</b><ul><li>Organic Jaggery 1kg — 1 day left, order ~13 kg</li><li>Filter Coffee 250g — 7 days left, order ~12 packs</li><li>Toothpaste 150g — 7 days left, order ~16</li></ul><small>From your sales of the last 30 days</small></div>
              <div className="chat-mock insight"><Bell size={16} /> <span><b>₹790 overdue</b> from 3 customers — send a reminder</span></div>
            </div>
          </div>
        </section>

        <section id="how" className="section wrap">
          <div className="section-head"><div className="eyebrow">How it works</div><h2>Up and running <span>in minutes</span></h2></div>
          <div className="steps">
            {[[1, 'Add your products', 'Type them in, or import a CSV from your current spreadsheet.'], [2, 'Bill and track as you go', 'Record sales, receive stock and complete orders. Stock and revenue update together.'], [3, 'Act on what OpsMitra finds', 'Follow the insights, ask questions and review your profit any time.']].map(([n, t, d]) => (
              <div className="step" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>
            ))}
          </div>
        </section>

        <section className="section wrap trust">
          <div><ShieldCheck size={22} /><h3>Your data stays yours</h3><p>Accounts are fully separate, sessions use secure HttpOnly cookies, and money maths is done in exact paise.</p></div>
          <div><FileText size={22} /><h3>Invoices &amp; GST ready</h3><p>Printable invoices with your business details, per-item GST and a tax summary by rate.</p></div>
          <div><Truck size={22} /><h3>Suppliers &amp; restocking</h3><p>Record purchases, track costs and keep a complete history of every stock movement.</p></div>
          <div><MessageSquare size={22} /><h3>Built to be explained</h3><p>Forecasts are labelled estimates and insights are rule-based, so you always know what you are looking at.</p></div>
        </section>

        <section id="faq" className="section wrap faq">
          <div className="section-head"><div className="eyebrow">Questions</div><h2>Good to know</h2></div>
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </section>

        <section className="cta-band"><div className="wrap cta-inner">
          <div><h2>Ready to make room for what matters?</h2><p>Explore OpsMitra with realistic sample data, or start your own workspace in a minute.</p></div>
          <div className="cta-actions"><Button size="lg" className="btn-light" onClick={tryDemo} loading={busy}>Try the live demo</Button><Button as={Link} to="/register" size="lg" variant="ghost" className="btn-outline-light">Create workspace</Button></div>
        </div></section>
      </main>

      <footer className="site-footer wrap">
        <Link to="/" className="brand-link"><img src="/opsmitra-logo.png" alt="" /><span>OpsMitra</span></Link>
        <span>© {new Date().getFullYear()} OpsMitra prototype</span>
        <span>Your Business, Simplified by AI</span>
      </footer>
    </div>
  );
}

/** A static, illustrative dashboard (sample numbers, clearly labelled). */
function HeroPreview() {
  const bars = [34, 48, 41, 66, 54, 83, 71, 60, 77, 92];
  return (
    <div className="hero-visual" aria-hidden="true">
      <div className="preview">
        <div className="preview-head"><b>Today</b><span>Sample data</span></div>
        <div className="preview-kpis">
          <div><small>Sales today</small><strong>₹18,450</strong><em>▲ 12% vs yesterday</em></div>
          <div><small>Gross profit</small><strong>₹2,380</strong><em>12.9% margin</em></div>
          <div><small>To restock</small><strong>3</strong><em>items running low</em></div>
        </div>
        <div className="preview-chart">{bars.map((h, i) => <span key={i} style={{ height: `${h}%` }} className={i === 9 ? 'hot' : ''} />)}</div>
        <div className="preview-alert"><Package size={16} /><div><b>Filter Coffee 250g</b><small>7 days of stock left · order ~12</small></div></div>
        <div className="preview-alert warn"><Bell size={16} /><div><b>₹790 overdue</b><small>3 customers · oldest 15 days</small></div></div>
      </div>
    </div>
  );
}
