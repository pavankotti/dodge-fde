'use client';
import { useState, useEffect } from 'react';
import GraphView from '../components/GraphView';
import ChatPanel from '../components/ChatPanel';

export default function Home() {
  const [selectedNode, setSelectedNode] = useState(null);
  const [highlightIds, setHighlightIds] = useState(new Set());
  const [graphStats, setGraphStats] = useState({ nodes: 0, links: 0 });

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: '#0f0f0f',
    }}>
      {/* Graph panel */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fafafa' }}>
        <TopBar highlightIds={highlightIds} onClearHighlight={() => setHighlightIds(new Set())} />
        <GraphView
          onNodeClick={setSelectedNode}
          highlightIds={highlightIds}
          onStatsUpdate={setGraphStats}
        />
      </div>

      {/* Chat panel — dark sidebar */}
      <div style={{
        width: 420, flexShrink: 0,
        background: '#111', borderLeft: '1px solid #222',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
      }}>
        <ChatPanel
          selectedNode={selectedNode}
          onHighlight={setHighlightIds}
          graphStats={graphStats}
        />
      </div>
    </div>
  );
}

const LEGEND = [
  { color: '#3b82f6', label: 'Order' },
  { color: '#10b981', label: 'Delivery' },
  { color: '#f59e0b', label: 'Invoice' },
  { color: '#8b5cf6', label: 'Journal' },
  { color: '#ef4444', label: 'Payment' },
  { color: '#6366f1', label: 'Customer' },
];

function TopBar({ highlightIds, onClearHighlight }) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, height: 50,
      background: 'rgba(250,250,250,0.95)', backdropFilter: 'blur(16px)',
      borderBottom: '1px solid rgba(0,0,0,0.08)',
      display: 'flex', alignItems: 'center', padding: '0 18px', gap: 8,
    }}>
      {/* Logo */}
      <div style={{
        width: 26, height: 26, background: '#111', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 800, fontSize: 12, letterSpacing: '-0.5px', flexShrink: 0,
      }}>D</div>
      <span style={{ color: '#c4c4c4', fontSize: 12, fontWeight: 400 }}>Mapping</span>
      <span style={{ color: '#ddd', fontSize: 12 }}>/</span>
      <span style={{ fontWeight: 600, fontSize: 12, color: '#111', letterSpacing: '-0.2px' }}>Order to Cash</span>

      {highlightIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, marginLeft: 6,
          background: '#f0fdf4', border: '1px solid #bbf7d0',
          borderRadius: 20, padding: '2px 10px', fontSize: 11, color: '#15803d',
          animation: 'fadeIn 0.2s ease',
        }}>
          <style>{`@keyframes fadeIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}`}</style>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
          {highlightIds.size} highlighted
          <button onClick={onClearHighlight} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#86efac', fontSize: 13, lineHeight: 1, padding: '0 0 0 2px', marginLeft: 2,
          }}>×</button>
        </div>
      )}

      {/* Legend */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
        {LEGEND.map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}