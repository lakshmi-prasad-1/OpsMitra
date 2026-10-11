import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCheck, CircleAlert, Info } from 'lucide-react';
import { api } from '../lib/api.js';

const KEY = 'opsmitra_read_notifications';
const readSet = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
const saveSet = set => { try { localStorage.setItem(KEY, JSON.stringify([...set].slice(-100))); } catch { /* storage blocked */ } };
const ICON = { critical: CircleAlert, warning: AlertTriangle, info: Info };
const TONE = { critical: 'tone-red', warning: 'tone-amber', info: 'tone-blue' };

export default function Notifications() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(readSet);
  const ref = useRef(null);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/notifications'), refetchInterval: 120000, staleTime: 60000 });
  const items = data?.items ?? [];
  const unread = items.filter(i => !read.has(i.id));

  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const markAll = () => { const next = new Set([...read, ...items.map(i => i.id)]); setRead(next); saveSet(next); };
  const openItem = item => { const next = new Set(read).add(item.id); setRead(next); saveSet(next); setOpen(false); navigate(item.href); };

  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn bell" onClick={() => setOpen(o => !o)} aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`} aria-expanded={open}>
        <Bell size={20} />{unread.length > 0 && <span className="bell-count">{unread.length}</span>}
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <div className="dropdown-head">
            <span>Notifications</span>
            {unread.length > 0 && <button className="link" onClick={markAll}><CheckCheck size={14} /> Mark all read</button>}
          </div>
          <div className="dropdown-list">
            {items.length === 0 && <div className="state"><p>You&apos;re all caught up. 🎉</p></div>}
            {items.map(item => {
              const Icon = ICON[item.severity] || Info;
              return (
                <button key={item.id} className={`dropdown-item ${read.has(item.id) ? 'read' : ''}`} onClick={() => openItem(item)}>
                  <i className={`kpi-icon ${TONE[item.severity]}`} style={{ width: 32, height: 32 }}><Icon size={16} /></i>
                  <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
