'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const NODE_COLOR = {
  SalesOrder:      '#3b82f6',
  Delivery:        '#10b981',
  BillingDocument: '#f59e0b',
  JournalEntry:    '#8b5cf6',
  Payment:         '#ef4444',
  Customer:        '#6366f1',
};

const NODE_R = {
  Customer: 10, SalesOrder: 6, Delivery: 5,
  BillingDocument: 6, JournalEntry: 4, Payment: 5,
};

const LINK_COLOR = {
  PLACED:       '#6366f1',
  DELIVERED_BY: '#10b981',
  BILLED_AS:    '#f59e0b',
  POSTED_TO:    '#8b5cf6',
  PAID_BY:      '#ef4444',
};

export default function GraphView({ onNodeClick, highlightIds = new Set(), onStatsUpdate }) {
  const [graph, setGraph] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [hov, setHov] = useState(null);
  const fg = useRef();
  const hasHL = highlightIds.size > 0;

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/graph`)
      .then(r => r.json())
      .then(d => {
        setGraph(d);
        setLoading(false);
        onStatsUpdate?.({ nodes: d.nodes?.length || 0, links: d.links?.length || 0 });
      })
      .catch(() => setLoading(false));
  }, []);

  // Tune forces for hub-spoke layout
  useEffect(() => {
    if (!fg.current || loading) return;
    const timer = setTimeout(() => {
      try {
        fg.current.d3Force('charge').strength(n =>
          n.type === 'Customer' ? -400 : -80
        );
        fg.current.d3Force('link').distance(l => {
          if (l.type === 'PLACED') return 90;
          if (l.type === 'DELIVERED_BY') return 60;
          if (l.type === 'BILLED_AS') return 50;
          return 40;
        }).strength(l => l.type === 'PLACED' ? 0.8 : 0.4);
        fg.current.d3ReheatSimulation();
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [loading]);

  // Zoom to highlighted nodes
  useEffect(() => {
    if (!fg.current || highlightIds.size === 0) return;
    const timer = setTimeout(() => {
      try {
        const nodes = graph.nodes.filter(n => highlightIds.has(n.id));
        if (!nodes.length) return;
        if (nodes.length === 1) {
          fg.current.centerAt(nodes[0].x, nodes[0].y, 600);
          fg.current.zoom(4, 600);
        } else {
          fg.current.zoomToFit(600, 100, n => highlightIds.has(n.id));
        }
      } catch {}
    }, 400);
    return () => clearTimeout(timer);
  }, [highlightIds, graph.nodes]);

  const handleClick = useCallback(node => {
    setSel(node);
    onNodeClick?.(node);
    fg.current?.centerAt(node.x, node.y, 500);
    fg.current?.zoom(4.5, 500);
  }, [onNodeClick]);

  const drawNode = useCallback((node, ctx, gs) => {
    const color = NODE_COLOR[node.type] || '#888';
    const r = NODE_R[node.type] || 5;
    const isSel = sel?.id === node.id;
    const isHL = highlightIds.has(node.id);
    const isHov = hov?.id === node.id;
    const isDim = hasHL && !isHL && !isSel;
    const scale = isSel ? 1.8 : isHL ? 1.5 : isHov ? 1.25 : 1;

    if (isDim) {
      ctx.beginPath(); ctx.arc(node.x, node.y, r * 0.8, 0, 2 * Math.PI);
      ctx.fillStyle = color + '18'; ctx.fill();
      return;
    }

    // Pulse rings for highlighted nodes
    if (isHL && !isSel) {
      [3.5, 2.5].forEach((m, i) => {
        ctx.beginPath(); ctx.arc(node.x, node.y, r * m, 0, 2 * Math.PI);
        ctx.fillStyle = color + (i === 0 ? '10' : '20'); ctx.fill();
      });
      ctx.beginPath(); ctx.arc(node.x, node.y, r * 2, 0, 2 * Math.PI);
      ctx.strokeStyle = color + '55'; ctx.lineWidth = 1.5 / gs; ctx.stroke();
    }

    // Selection rings
    if (isSel) {
      [4, 2.8].forEach((m, i) => {
        ctx.beginPath(); ctx.arc(node.x, node.y, r * m, 0, 2 * Math.PI);
        ctx.fillStyle = color + (i === 0 ? '10' : '22'); ctx.fill();
      });
    }

    // Main circle
    ctx.beginPath(); ctx.arc(node.x, node.y, r * scale, 0, 2 * Math.PI);
    ctx.fillStyle = isSel ? color : isHL ? color + 'ee' : isHov ? color + 'dd' : color + 'bb';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,' + (isSel || isHL ? '0.9' : '0.5') + ')';
    ctx.lineWidth = (isSel ? 2.5 : isHL ? 2 : 1) / gs;
    ctx.stroke();

    // Labels
    if (gs > 3 || isSel || isHL) {
      const fs = Math.max((isSel ? 11 : 9) / gs, 2);
      ctx.font = `${isSel || isHL ? 600 : 400} ${fs}px Inter,sans-serif`;
      ctx.textAlign = 'center';
      // Text shadow for legibility
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(node.label, node.x + 0.5, node.y + r * scale + fs * 1.5 + 0.5);
      ctx.fillStyle = '#111';
      ctx.fillText(node.label, node.x, node.y + r * scale + fs * 1.5);
    }
  }, [sel, hov, highlightIds, hasHL]);

  if (loading) return (
    <div style={{
      position: 'absolute', inset: 0, marginTop: 50,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
      background: '#fafafa',
    }}>
      <div style={{
        width: 36, height: 36, border: '2.5px solid #e5e5e5', borderTopColor: '#3b82f6',
        borderRadius: '50%', animation: 'spin 0.6s linear infinite',
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ color: '#999', fontSize: 13, fontWeight: 500 }}>Building graph…</span>
    </div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, marginTop: 50 }}>
      <ForceGraph2D
        ref={fg}
        graphData={graph}
        nodeCanvasObject={drawNode}
        nodeCanvasObjectMode={() => 'replace'}
        linkColor={l => {
          const base = LINK_COLOR[l.type] || '#888';
          if (hasHL) {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            return (highlightIds.has(src) || highlightIds.has(tgt)) ? base + 'cc' : '#88888810';
          }
          return base + '33';
        }}
        linkWidth={l => {
          if (hasHL) {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            return (highlightIds.has(src) || highlightIds.has(tgt)) ? 2 : 0.3;
          }
          return l.type === 'PLACED' ? 1.5 : 0.8;
        }}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={l => {
          if (!hasHL) return 1;
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          return (highlightIds.has(src) || highlightIds.has(tgt)) ? 4 : 0;
        }}
        linkDirectionalParticleWidth={2.5}
        linkDirectionalParticleColor={l => LINK_COLOR[l.type] || '#888'}
        onNodeClick={handleClick}
        onNodeHover={setHov}
        onBackgroundClick={() => { setSel(null); onNodeClick?.(null); }}
        cooldownTicks={250}
        backgroundColor="#fafafa"
        nodeLabel={() => ''}
        enableNodeDrag
      />

      {/* Node detail card */}
      {sel && (
        <div style={{
          position: 'absolute', top: 12, left: 12, width: 260,
          background: 'white', border: '1px solid #e8e8e8', borderRadius: 12,
          padding: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.10)', zIndex: 20,
          animation: 'slideIn 0.15s ease',
        }}>
          <style>{`@keyframes slideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: NODE_COLOR[sel.type] || '#888', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: 12, color: '#111', letterSpacing: '-0.2px' }}>{sel.type}</span>
            <button onClick={() => { setSel(null); onNodeClick?.(null); }} style={{
              marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
              color: '#bbb', fontSize: 17, lineHeight: 1, padding: '0 2px',
            }}>×</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {Object.entries(sel)
              .filter(([k, v]) => !['x', 'y', 'vx', 'vy', 'index', 'id', 'type', 'label'].includes(k) && v)
              .slice(0, 8)
              .map(([k, v]) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8,
                  padding: '3px 0', borderBottom: '1px solid #f5f5f5',
                }}>
                  <span style={{ fontSize: 11, color: '#aaa', textTransform: 'capitalize', flexShrink: 0 }}>
                    {k.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#111', textAlign: 'right', wordBreak: 'break-all', maxWidth: 140 }}>
                    {String(v).length > 28 ? String(v).slice(0, 28) + '…' : String(v)}
                  </span>
                </div>
              ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 9.5, color: '#ddd', fontFamily: 'monospace' }}>{sel.id}</div>
        </div>
      )}

      {/* Stats pill */}
      <div style={{
        position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.07)',
        borderRadius: 20, padding: '4px 14px', fontSize: 11, color: '#888',
        display: 'flex', gap: 10, alignItems: 'center',
        boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
      }}>
        {Object.entries(NODE_COLOR).map(([type, color]) => {
          const ct = graph.nodes.filter(n => n.type === type).length;
          return ct ? (
            <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
              {ct}
            </span>
          ) : null;
        })}
        <span style={{ color: '#ddd' }}>·</span>
        <span>{graph.links.length} edges</span>
      </div>
    </div>
  );
}