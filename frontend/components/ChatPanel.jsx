'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

const CHIPS = [
  { label: 'Top customers',         q: 'Top 5 customers by total order value' },
  { label: 'Trace invoice',         q: 'Trace billing document 91150187' },
  { label: 'Unfinished flows',      q: 'Sales orders delivered but not billed' },
  { label: 'Cancelled invoices',    q: 'Show cancelled billing documents' },
  { label: 'Product billing',       q: 'Which products have the most billing documents' },
];

const NODE_COLOR = {
  SalesOrder: '#3b82f6', Delivery: '#10b981', BillingDocument: '#f59e0b',
  JournalEntry: '#8b5cf6', Payment: '#ef4444', Customer: '#6366f1',
};

async function extractNodeIds(rows, apiUrl) {
  const ids = new Set();
  if (!rows?.length) return ids;
  const v = (val, prefix) => { if (val && String(val).trim() && String(val) !== 'null') ids.add(`${prefix}-${val}`); };
  const materials = new Set();
  for (const row of rows) {
    v(row.billingDocument, 'BILL');
    v(row.cancelledBillingDocument, 'BILL');
    v(row.salesOrder, 'SO');
    v(row.deliveryDocument, 'DEL');
    v(row.businessPartner, 'BP');
    v(row.soldToParty, 'BP');
    v(row.payerParty, 'BP');
    if (row.accountingDocument) ids.add(`JE-${row.accountingDocument}-1`);
    if (row.paymentDoc) ids.add(`JE-${row.paymentDoc}-1`);
    if (row.clearingAccountingDocument) ids.add(`PAY-${row.clearingAccountingDocument}-1`);
    // For material/product queries - resolve to related document nodes
    if (row.material && !row.billingDocument && !row.salesOrder) materials.add(row.material);
  }
  // Resolve materials to graph nodes via API
  for (const mat of materials) {
    try {
      const r = await fetch(`${apiUrl||'http://localhost:3001'}/api/graph/material/${encodeURIComponent(mat)}`);
      const d = await r.json();
      d.nodeIds?.forEach(id => ids.add(id));
    } catch {}
  }
  return ids;
}

// Typing animation for AI response
function useTypewriter(text, speed = 8) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!text) return;
    setDisplayed('');
    setDone(false);
    let i = 0;
    const id = setInterval(() => {
      if (i < text.length) { setDisplayed(text.slice(0, ++i)); }
      else { setDone(true); clearInterval(id); }
    }, speed);
    return () => clearInterval(id);
  }, [text]);
  return { displayed, done };
}

function EntityCard({ entity }) {
  const label = entity.businessPartnerName || entity.salesOrder || entity.billingDocument || entity.deliveryDocument;
  const id = entity.businessPartner || entity.salesOrder || entity.billingDocument || entity.deliveryDocument;
  const color = { business_partner: '#6366f1', sales_order: '#3b82f6', billing_document: '#f59e0b', delivery: '#10b981' }[entity.type] || '#888';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: color + '18', border: `1px solid ${color}44`,
      borderRadius: 6, padding: '3px 9px', fontSize: 11,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ color: '#ddd', fontWeight: 500 }}>{label}</span>
      <span style={{ color: '#666', fontFamily: 'monospace', fontSize: 10 }}>{id}</span>
    </div>
  );
}

function AssistantBubble({ msg, isLatest }) {
  const { displayed, done } = useTypewriter(isLatest ? msg.content : null, 6);
  const text = isLatest && !done ? displayed : msg.content;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      {/* Agent label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 20, height: 20, borderRadius: '50%', background: '#222',
          border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 9, flexShrink: 0,
        }}>D</div>
        <span style={{ fontSize: 11, color: '#555', fontWeight: 500 }}>Dodge AI</span>
        {isLatest && !done && (
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#10b981', display: 'inline-block', animation: 'pulse 1s infinite' }} />
        )}
      </div>

      {/* Entity cards */}
      {msg.entities?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {msg.entities.map((e, i) => <EntityCard key={i} entity={e} />)}
        </div>
      )}

      {/* Message bubble */}
      <div style={{
        maxWidth: '92%', padding: '10px 14px',
        borderRadius: '3px 14px 14px 14px',
        background: '#1a1a1a', border: '1px solid #2a2a2a',
        color: msg.off_topic ? '#ef4444' : '#e5e5e5',
        fontSize: 13, lineHeight: 1.6,
      }}>
        {text.split('**').map((p, i) => i % 2 === 1 ? <strong key={i} style={{ color: '#fff' }}>{p}</strong> : p)}
        {isLatest && !done && <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}>▊</span>}
      </div>

      {/* Highlight badge */}
      {msg.highlightCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#10b981' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
          {msg.highlightCount} nodes highlighted in graph
        </div>
      )}

      {/* SQL disclosure */}
      {msg.sql && (
        <details style={{ maxWidth: '92%' }}>
          <summary style={{
            fontSize: 11, color: '#555', cursor: 'pointer', userSelect: 'none',
            listStyle: 'none', display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            <span style={{ color: '#444' }}>SQL</span>
            <span style={{ color: '#333' }}>·</span>
            <span style={{ color: '#444' }}>{msg.rowCount ?? 0} rows</span>
          </summary>
          <pre style={{
            margin: '6px 0 0', fontSize: 10.5, background: '#0a0a0a', color: '#6b7280',
            padding: '10px 12px', borderRadius: 8, overflow: 'auto', maxHeight: 180,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.6,
            border: '1px solid #1a1a1a',
          }}>{msg.sql}</pre>
        </details>
      )}
    </div>
  );
}

function UserBubble({ msg }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#444' }}>You</span>
      <div style={{
        maxWidth: '88%', padding: '9px 13px',
        borderRadius: '14px 3px 14px 14px',
        background: '#1e1e1e', border: '1px solid #2e2e2e',
        color: '#e5e5e5', fontSize: 13, lineHeight: 1.55,
      }}>
        {msg.content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{
        width: 20, height: 20, borderRadius: '50%', background: '#1a1a1a',
        border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: 9,
      }}>D</div>
      <div style={{
        display: 'flex', gap: 4, padding: '8px 12px',
        background: '#1a1a1a', border: '1px solid #2a2a2a',
        borderRadius: '3px 12px 12px 12px',
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 5, height: 5, borderRadius: '50%', background: '#444', display: 'inline-block',
            animation: `dot 1.2s ease ${i * 0.2}s infinite`,
          }} />
        ))}
        <style>{`
          @keyframes dot{0%,80%,100%{transform:scale(.7);opacity:.4}40%{transform:scale(1);opacity:1}}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
          @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        `}</style>
      </div>
    </div>
  );
}

export default function ChatPanel({ selectedNode, onHighlight, graphStats }) {
  const [msgs, setMsgs] = useState([{
    role: 'assistant',
    content: 'Hi! Ask me anything about the **Order to Cash** process — customers, orders, deliveries, invoices, or payments.',
    entities: [],
  }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const [latestIdx, setLatestIdx] = useState(0);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  useEffect(() => {
    if (selectedNode) {
      setInput(`Tell me about ${selectedNode.label}`);
      inputRef.current?.focus();
    }
  }, [selectedNode]);

  const send = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);
    onHighlight?.(new Set());

    // Build history for multi-turn context
    const history = msgs.slice(-6).map(m => ({ role: m.role, content: m.content }));
    setMsgs(p => [...p, { role: 'user', content: msg }]);

    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history }),
      });
      const d = await r.json();
      const ids = await extractNodeIds(d.data, process.env.NEXT_PUBLIC_API_URL||"http://localhost:3001");
      if (ids.size > 0) onHighlight?.(ids);

      const newMsg = {
        role: 'assistant',
        content: d.answer || d.error || 'Something went wrong.',
        sql: d.sql, rowCount: d.rowCount, off_topic: d.off_topic,
        entities: d.entities || [],
        highlightCount: ids.size,
      };
      setMsgs(p => { setLatestIdx(p.length); return [...p, newMsg]; });
    } catch {
      setMsgs(p => { setLatestIdx(p.length); return [...p, { role: 'assistant', content: 'Network error — is the backend running?', entities: [] }]; });
    }
    setBusy(false);
  }, [input, busy, msgs, onHighlight]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: '#e5e5e5' }}>

      {/* Header */}
      <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid #1e1e1e' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#fff', letterSpacing: '-0.3px' }}>Chat with Graph</div>
        <div style={{ fontSize: 11, color: '#444', marginTop: 1 }}>Order to Cash · Powered by Groq</div>
      </div>

      {/* Agent bar */}
      <div style={{ padding: '10px 18px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 34, height: 34, background: '#1a1a1a', borderRadius: '50%',
          border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0,
        }}>D</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>Dodge AI</div>
          <div style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            Graph Agent · Online
          </div>
        </div>
        {/* Graph stats */}
        {graphStats?.nodes > 0 && (
          <div style={{ fontSize: 10.5, color: '#444', textAlign: 'right', lineHeight: 1.5 }}>
            <div>{graphStats.nodes} nodes</div>
            <div>{graphStats.links} edges</div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 16,
        scrollbarWidth: 'thin', scrollbarColor: '#222 transparent',
      }}>
        {msgs.map((m, i) =>
          m.role === 'user'
            ? <UserBubble key={i} msg={m} />
            : <AssistantBubble key={i} msg={m} isLatest={i === latestIdx && !busy} />
        )}
        {busy && <TypingIndicator />}
        <div ref={endRef} />
      </div>

      {/* Quick chips — only when fresh */}
      {msgs.length === 1 && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{ fontSize: 10.5, color: '#444', marginBottom: 6, paddingLeft: 2 }}>Quick queries</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {CHIPS.map((c, i) => (
              <button key={i} onClick={() => send(c.q)} style={{
                padding: '5px 10px', borderRadius: 6,
                border: '1px solid #2a2a2a', background: '#151515',
                color: '#888', cursor: 'pointer', fontSize: 11.5,
                transition: 'all .12s',
              }}
                onMouseOver={e => { e.currentTarget.style.background = '#1e1e1e'; e.currentTarget.style.color = '#ccc'; e.currentTarget.style.borderColor = '#3a3a3a'; }}
                onMouseOut={e => { e.currentTarget.style.background = '#151515'; e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#2a2a2a'; }}
              >{c.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a', display: 'flex', gap: 7, alignItems: 'center' }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          border: '1px solid #2a2a2a', borderRadius: 10, padding: '8px 12px',
          background: '#151515', transition: 'border-color .15s',
        }}
          onFocusCapture={e => e.currentTarget.style.borderColor = '#3b82f6'}
          onBlurCapture={e => e.currentTarget.style.borderColor = '#2a2a2a'}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Ask anything about the data…"
            disabled={busy}
            style={{
              flex: 1, border: 'none', background: 'none', outline: 'none',
              fontSize: 13, color: '#e5e5e5',
            }}
          />
        </div>
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          style={{
            padding: '8px 14px', borderRadius: 9, border: 'none',
            background: input.trim() && !busy ? '#3b82f6' : '#1a1a1a',
            color: input.trim() && !busy ? '#fff' : '#444',
            cursor: input.trim() && !busy ? 'pointer' : 'not-allowed',
            fontWeight: 600, fontSize: 12.5, transition: 'all .15s', flexShrink: 0,
          }}
        >Send</button>
      </div>
    </div>
  );
}