import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BrainCircuit, ClipboardList, Package, PackagePlus, Plus, Receipt, Search, ShoppingBag, Truck, Users } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useDebounced } from '../lib/hooks.js';
import { money } from '../lib/format.js';

const ACTIONS = [
  { label: 'New sale', icon: Plus, to: '/app/sales/new', words: 'sell pos bill invoice' },
  { label: 'Add product', icon: PackagePlus, to: '/app/inventory?new=1', words: 'inventory item stock' },
  { label: 'Create order', icon: ClipboardList, to: '/app/orders/new', words: 'order customer' },
  { label: 'Receive stock', icon: Truck, to: '/app/purchases/new', words: 'purchase supplier restock buy' },
  { label: 'Ask OpsMitra', icon: BrainCircuit, to: '/app/assistant', words: 'ai assistant chat question help' },
  { label: 'View reports', icon: Receipt, to: '/app/reports', words: 'profit sales report gst' }
];

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const q = useDebounced(text.trim(), 200);
  const { data } = useQuery({ queryKey: ['search', q], queryFn: () => api.get(`/search${qs({ q })}`), enabled: open && q.length >= 2, staleTime: 15000 });

  useEffect(() => { if (open) { setText(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const items = useMemo(() => {
    const lower = text.trim().toLowerCase();
    const actions = ACTIONS.filter(a => !lower || a.label.toLowerCase().includes(lower) || a.words.includes(lower)).map(a => ({ group: 'Quick actions', ...a }));
    const found = [];
    if (data && q.length >= 2) {
      data.products.forEach(p => found.push({ group: 'Products', label: p.name, sub: `${p.sku} · ${p.quantity} in stock`, icon: Package, to: `/app/inventory/${p.id}` }));
      data.customers.forEach(c => found.push({ group: 'Customers', label: c.name, sub: c.phone || '', icon: Users, to: `/app/customers/${c.id}` }));
      data.sales.forEach(s => found.push({ group: 'Sales', label: s.number, sub: `${money(s.total)}${s.customer ? ` · ${s.customer}` : ''}`, icon: Receipt, to: `/app/sales/${s.id}` }));
      data.orders.forEach(o => found.push({ group: 'Orders', label: o.number, sub: `${o.status}${o.customer ? ` · ${o.customer}` : ''}`, icon: ShoppingBag, to: `/app/orders/${o.id}` }));
      data.suppliers.forEach(s => found.push({ group: 'Suppliers', label: s.name, sub: '', icon: Truck, to: `/app/suppliers/${s.id}` }));
    }
    return [...found, ...actions];
  }, [data, q, text]);

  if (!open) return null;
  const go = item => { onClose(); navigate(item.to); };
  const onKey = e => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); go(items[active]); }
  };
  let lastGroup = '';
  return (
    <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and quick actions" onKeyDown={onKey}>
        <div className="palette-input">
          <Search size={18} />
          <input ref={inputRef} value={text} onChange={e => { setText(e.target.value); setActive(0); }} placeholder="Search products, customers, invoices… or type an action" aria-label="Search" />
        </div>
        <div className="palette-results">
          {items.length === 0 && <div className="state"><p>{q.length >= 2 ? 'No matches found.' : 'Type at least 2 characters to search.'}</p></div>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? <div className="palette-group" key={`g-${item.group}`}>{item.group}</div> : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={`${item.group}-${item.label}-${i}`}>
                {header}
                <button className={`palette-item ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(item)}>
                  <Icon size={17} /><span>{item.label}</span>{item.sub && <small>{item.sub}</small>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
