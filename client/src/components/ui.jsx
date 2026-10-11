import { useEffect, useId, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowDownRight, ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { titleCase } from '../lib/format.js';

export function Button({ variant = 'primary', size, icon: Icon, loading, children, className = '', as: As = 'button', ...props }) {
  const cls = `btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`.trim();
  return (
    <As className={cls} disabled={props.disabled || loading} {...props}>
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={size === 'lg' ? 18 : 16} /> : null}
      {children}
    </As>
  );
}
export const LinkButton = ({ to, ...props }) => <Button as={Link} to={to} {...props} />;

export function PageHeader({ title, subtitle, actions, back, eyebrow }) {
  const navigate = useNavigate();
  return (
    <div className="page-header">
      <div className="page-header-main">
        {back && <button className="back-link" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}><ArrowLeft size={15} /> Back</button>}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, subtitle, actions, children, className = '', flush }) {
  return (
    <section className={`panel ${flush ? 'panel-flush' : ''} ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const TONES = { green: 'tone-green', amber: 'tone-amber', red: 'tone-red', blue: 'tone-blue', gray: 'tone-gray', purple: 'tone-purple' };
export const Badge = ({ tone = 'gray', children, dot }) => <span className={`badge ${TONES[tone] || TONES.gray}`}>{dot && <i />}{children}</span>;

const STATUS_TONE = {
  completed: 'green', paid: 'green', 'in stock': 'green', active: 'green', delivered: 'green', ok: 'green',
  pending: 'amber', processing: 'blue', ready: 'purple', partial: 'amber', 'low stock': 'amber', warning: 'amber', due: 'amber', expiring: 'amber',
  cancelled: 'red', voided: 'red', void: 'red', unpaid: 'red', 'out of stock': 'red', critical: 'red', expired: 'red', archived: 'gray'
};
export const StatusBadge = ({ status, label }) => <Badge tone={STATUS_TONE[String(status).toLowerCase()] || 'gray'} dot>{label || titleCase(status)}</Badge>;

export function Kpi({ label, value, hint, icon: Icon, tone = 'green', change, to }) {
  const body = (
    <>
      <div className="kpi-top"><span>{label}</span>{Icon && <i className={`kpi-icon tone-${tone}`}><Icon size={18} /></i>}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">
        {change != null && Number.isFinite(change) && (
          <span className={`delta ${change >= 0 ? 'delta-up' : 'delta-down'}`}>{change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(Math.round(change))}%</span>
        )}
        {hint && <span className="kpi-hint">{hint}</span>}
      </div>
    </>
  );
  return to ? <Link to={to} className="kpi kpi-link">{body}</Link> : <div className="kpi">{body}</div>;
}

export function Skeleton({ height = 16, width = '100%', className = '' }) { return <span className={`skeleton ${className}`} style={{ height, width }} />; }
export function PageLoader({ label = 'Loading…' }) {
  return <div className="page-loader" role="status"><Loader2 className="spin" size={22} /><span>{label}</span></div>;
}
export function SkeletonRows({ rows = 6 }) {
  return <div className="skeleton-rows" aria-busy="true">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={38} />)}</div>;
}

export function ErrorState({ error, onRetry, title = "We couldn't load this" }) {
  return (
    <div className="state state-error" role="alert">
      <span className="state-icon"><AlertCircle size={22} /></span>
      <h3>{title}</h3>
      <p>{error?.message || 'Something went wrong.'}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="state">
      {Icon && <span className="state-icon"><Icon size={22} /></span>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '', required }) {
  const id = useId();
  return (
    <div className={`field ${error ? 'field-error' : ''} ${className}`}>
      <label htmlFor={id}>{label}{required && <b aria-hidden="true"> *</b>}</label>
      {typeof children === 'function' ? children({ id, 'aria-invalid': error ? true : undefined }) : children}
      {error ? <small className="field-msg" role="alert">{error}</small> : hint ? <small className="field-hint">{hint}</small> : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <label className={`search ${className}`}>
      <Search size={16} />
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button type="button" onClick={() => onChange('')} aria-label="Clear search"><X size={14} /></button>}
    </label>
  );
}

export function Select({ label, value, onChange, options, className = '' }) {
  return (
    <label className={`select-inline ${className}`}>
      {label && <span>{label}</span>}
      <select value={value} onChange={e => onChange(e.target.value)}>{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select>
    </label>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([key, label, count]) => (
        <button key={key} role="tab" aria-selected={value === key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>
          {label}{count != null && <span className="tab-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.pages <= 1) return meta ? <div className="pagination"><span>{meta.total} result{meta.total === 1 ? '' : 's'}</span></div> : null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>{from}–{to} of {meta.total}</span>
      <div>
        <button className="icon-btn" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
        <span className="page-num">Page {meta.page} of {meta.pages}</span>
        <button className="icon-btn" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
      </div>
    </nav>
  );
}

export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement;
    ref.current?.querySelector('input,select,textarea,button:not(.modal-x)')?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; previous?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head"><h2 className="modal-title">{title}</h2><button className="icon-btn modal-x" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-actions">{footer}</footer>}
      </div>
    </div>
  );
}

export function DefinitionList({ items }) {
  return <dl className="dl">{items.filter(Boolean).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>;
}

/** Number input that returns strings (so "" is representable) with sensible defaults. */
export const NumberInput = props => <input type="number" inputMode="decimal" {...props} />;
