import { useState, useCallback } from 'react';
import { NODE_COLORS } from '../lib/constants';

interface PaletteEntry {
  type: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  tags: string[];
}

const PALETTE: PaletteEntry[] = [
  {
    type: 'source',
    label: 'Source',
    icon: '📥',
    color: NODE_COLORS.source,
    description: 'Where text enters the pipeline',
    tags: ['input', 'text', 'file', 'http', 'stdin'],
  },
  {
    type: 'lens',
    label: 'Lens',
    icon: '🔮',
    color: NODE_COLORS.lens,
    description: 'Model call — transforms text through a prompt',
    tags: ['model', 'llm', 'transform', 'prompt', 'ai'],
  },
  {
    type: 'gate',
    label: 'Gate',
    icon: '🔀',
    color: NODE_COLORS.gate,
    description: 'Conditional router — sends text down one branch',
    tags: ['route', 'conditional', 'branch', 'switch', 'if'],
  },
  {
    type: 'bcc',
    label: 'BCC',
    icon: '👻',
    color: NODE_COLORS.bcc,
    description: 'Silent fork — runs without appearing in main flow',
    tags: ['silent', 'fork', 'background', 'log', 'hidden'],
  },
  {
    type: 'sink',
    label: 'Sink',
    icon: '💾',
    color: NODE_COLORS.sink,
    description: 'Where text exits — stdout, file, or HTTP',
    tags: ['output', 'save', 'file', 'http', 'stdout'],
  },
];

export function NodePalette() {
  const [search, setSearch] = useState('');

  const filtered = search
    ? PALETTE.filter((entry) => {
        const q = search.toLowerCase();
        return (
          entry.label.toLowerCase().includes(q) ||
          entry.description.toLowerCase().includes(q) ||
          entry.tags.some((t) => t.includes(q))
        );
      })
    : PALETTE;

  const onDragStart = useCallback(
    (e: React.DragEvent, entry: PaletteEntry) => {
      e.dataTransfer.setData('application/playdesk-node-type', entry.type);
      e.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  return (
    <div className="node-palette">
      <div className="palette-header">Pieces</div>
      <div className="palette-search">
        <input
          type="text"
          placeholder="Search pieces..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="palette-list">
        {filtered.map((entry) => (
          <div
            key={entry.type}
            className="palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, entry)}
          >
            <div
              className="palette-item-accent"
              style={{ background: entry.color }}
            />
            <div className="palette-item-body">
              <div className="palette-item-header">
                <span className="palette-item-icon">{entry.icon}</span>
                <span className="palette-item-label">{entry.label}</span>
              </div>
              <div className="palette-item-desc">{entry.description}</div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="palette-empty">No matches</div>
        )}
      </div>
    </div>
  );
}
