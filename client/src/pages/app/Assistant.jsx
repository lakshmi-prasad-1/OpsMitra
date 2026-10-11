import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Sparkles, User } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { Badge, Button, PageHeader } from '../../components/ui.jsx';

const SUGGESTIONS = ['What should I restock this week?', 'How were sales this month?', 'Who owes me money?', 'Which products are not selling?', 'What are my top products?', 'What will sales look like next week?', 'What is expiring soon?'];

/** Renders the small Markdown subset the assistant emits: **bold**, _italic_, "- " bullets, blank-line paragraphs. */
function RichText({ text }) {
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) => part.startsWith('**') ? <strong key={`${k}${i}`}>{part.slice(2, -2)}</strong> : part.startsWith('_') && part.endsWith('_') && part.length > 2 ? <em key={`${k}${i}`}>{part.slice(1, -1)}</em> : part);
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n');
    const items = lines.filter(l => l.startsWith('- '));
    const head = lines.filter(l => !l.startsWith('- '));
    return (
      <div key={bi} style={{ marginTop: bi ? 10 : 0 }}>
        {head.length > 0 && <p>{head.map((l, i) => <span key={i}>{i > 0 && <br />}{inline(l, `h${bi}-${i}`)}</span>)}</p>}
        {items.length > 0 && <ul>{items.map((l, i) => <li key={i}>{inline(l.slice(2), `l${bi}-${i}`)}</li>)}</ul>}
      </div>
    );
  });
}

export default function Assistant() {
  useDocumentTitle('Ask OpsMitra');
  const status = useApi(['assistant', 'status'], '/assistant/status', { staleTime: 300000 });
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  const ask = async question => {
    const q = question.trim();
    if (!q || busy) return;
    const history = messages.filter(m => !m.error).map(m => ({ role: m.role, content: m.text }));
    setMessages(m => [...m, { role: 'user', text: q }]); setText(''); setBusy(true);
    try {
      const r = await api.post('/assistant/ask', { question: q, history });
      setMessages(m => [...m, { role: 'assistant', text: r.answer, mode: r.mode, sources: r.sources, notice: r.notice }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', text: e.message, error: true }]);
    } finally { setBusy(false); }
  };
  const mode = status.data?.mode;

  return (
    <>
      <PageHeader title="Ask OpsMitra" subtitle="Ask about your sales, stock, customers and dues in plain words."
        actions={mode && <Badge tone={mode === 'claude' ? 'green' : 'gray'} dot>{mode === 'claude' ? 'AI assistant (Claude)' : 'Built-in assistant'}</Badge>} />
      <div className="panel chat">
        <div className="chat-log" ref={log} aria-live="polite">
          {messages.length === 0 && (
            <div className="state" style={{ margin: 'auto' }}>
              <span className="state-icon"><Sparkles size={22} /></span>
              <h3>What would you like to know?</h3>
              <p>I read your live records and answer with real numbers. I can&apos;t change anything — I&apos;ll point you to the right screen.</p>
              <div className="suggestions" style={{ justifyContent: 'center', marginTop: 12 }}>{SUGGESTIONS.map(s => <button key={s} onClick={() => ask(s)}>{s}</button>)}</div>
              {mode === 'offline' && <p style={{ fontSize: 13, marginTop: 8 }}>Running in built-in mode: it understands common business questions. Set <code>ANTHROPIC_API_KEY</code> on the server to enable open-ended AI answers.</p>}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <span className="avatar">{m.role === 'user' ? <User size={16} /> : <Bot size={16} />}</span>
              <div>
                <div className="bubble" style={m.error ? { borderColor: 'var(--danger)' } : undefined}>{m.role === 'user' ? m.text : <RichText text={m.text} />}</div>
                {m.role === 'assistant' && !m.error && <div className="meta">{m.notice ? `${m.notice} ` : ''}{m.sources?.length ? `Based on: ${[...new Set(m.sources)].map(s => s.replaceAll('_', ' ')).join(', ')}` : ''}</div>}
              </div>
            </div>
          ))}
          {busy && <div className="msg"><span className="avatar"><Bot size={16} /></span><div className="bubble typing" aria-label="Thinking"><span /><span /><span /></div></div>}
        </div>
        {messages.length > 0 && <div className="suggestions" style={{ marginTop: 8, marginBottom: 0 }}>{SUGGESTIONS.slice(0, 4).map(s => <button key={s} onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>}
        <form className="chat-input" onSubmit={e => { e.preventDefault(); ask(text); }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="e.g. Who owes me money?" maxLength={600} aria-label="Your question" disabled={busy} />
          <Button type="submit" icon={Send} disabled={!text.trim()} loading={busy}>Ask</Button>
        </form>
      </div>
    </>
  );
}
