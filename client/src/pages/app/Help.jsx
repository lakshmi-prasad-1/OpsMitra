import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../../lib/hooks.js';
import { PageHeader, Panel } from '../../components/ui.jsx';

const GUIDES = [
  ['Getting started', 'Add products in Inventory (or import a CSV), add a few customers, then record your first sale from New sale. In a hurry? Load sample data from the dashboard.'],
  ['How does a sale change stock?', 'Completing a sale checks availability and deducts stock in a single step. If anything is short, nothing is recorded. Every change appears in the product\'s stock history.'],
  ['Selling on credit', 'Choose Credit when billing a customer. The unpaid amount becomes their balance. Record payments from the customer page or the invoice; they apply to the oldest invoices first.'],
  ['What happens when an order is completed or cancelled?', 'Completing an order deducts stock and creates one invoice. Cancelling a completed order returns the stock and voids that invoice. Cancelled orders cannot be reopened.'],
  ['Receiving stock from a supplier', 'Use Receive stock. It raises quantities, updates each product\'s cost price and records the purchase, so profit reports stay accurate.'],
  ['How is profit calculated?', 'Gross profit = sales (without the GST included in prices) minus the cost price recorded at the time of sale, minus discounts. Set cost prices in Inventory for accurate numbers.'],
  ['Are the insights real AI?', 'Insights are rule-based and always show their evidence. Forecasts are statistical estimates. The Ask OpsMitra assistant answers from your live data; with an Anthropic API key configured it uses Claude, otherwise a built-in engine.'],
  ['Can I undo a mistake?', 'Void a direct sale from its invoice, cancel an order, or use Adjust stock with a reason. Records are never silently deleted — products and customers are archived, not erased.']
];
const SHORTCUTS = [['Ctrl / ⌘ + K', 'Search anything or run a quick action'], ['Enter (in POS search)', 'Add the scanned or exactly-matching product'], ['Esc', 'Close dialogs and menus']];

export default function Help() {
  useDocumentTitle('Help & support');
  return (
    <>
      <PageHeader title="Help & support" subtitle="Quick answers about how OpsMitra works." />
      <div className="grid-main">
        <Panel title="Guides">
          {GUIDES.map(([q, a]) => <details key={q} style={{ borderBottom: '1px solid var(--line)', padding: '14px 0' }}><summary style={{ cursor: 'pointer', fontWeight: 700 }}>{q}</summary><p className="muted" style={{ marginTop: 8, lineHeight: 1.65 }}>{a}</p></details>)}
        </Panel>
        <div className="stack">
          <Panel title="Keyboard shortcuts"><div className="list">{SHORTCUTS.map(([k, d]) => <div className="list-row" key={k}><div><strong>{k}</strong><small>{d}</small></div></div>)}</div></Panel>
          <Panel title="Need a hand?"><p className="muted" style={{ marginBottom: 12 }}>Try asking the assistant first — it can look things up in your records.</p><Link className="link" to="/app/assistant">Ask OpsMitra →</Link></Panel>
        </div>
      </div>
    </>
  );
}
