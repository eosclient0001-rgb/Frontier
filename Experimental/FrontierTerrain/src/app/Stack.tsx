// Layer stack: ordered list with thumbnails, enable toggles, drag reorder,
// delete and a grouped "add" menu. Used by both the terrain and texture stages.
import { useState } from 'react';
import type { DragEvent } from 'react';
import { Plus, Eye, EyeOff, Trash2, GripVertical, ChevronDown } from 'lucide-react';

export interface StackItem {
  id: string;
  name: string;
  sub: string;
  enabled: boolean;
  thumb?: string;
  badge?: string;
}

export interface AddGroup {
  group: string;
  items: { id: string; label: string; sub: string; color?: string }[];
}

export function LayerStack(props: {
  title: string;
  eyebrow: string;
  items: StackItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, on: boolean) => void;
  onDelete: (id: string) => void;
  onMove: (from: number, to: number) => void;
  addGroups: AddGroup[];
  onAdd: (id: string) => void;
  maxItems?: number;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const full = props.maxItems !== undefined && props.items.length >= props.maxItems;

  const onDragStart = (i: number) => (e: DragEvent) => {
    setDragFrom(i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  };
  const onDrop = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    if (dragFrom !== null && dragFrom !== i) props.onMove(dragFrom, i);
    setDragFrom(null);
    setOverIdx(null);
  };

  return (
    <div className="stack">
      <div className="stack-head">
        <div>
          <div className="eyebrow">{props.eyebrow}</div>
          <h2>{props.title}<span>{props.items.length}{props.maxItems ? `/${props.maxItems}` : ''}</span></h2>
        </div>
        <div className="add-wrap">
          <button
            type="button"
            className="add-btn"
            disabled={full}
            onClick={() => setOpen((o) => !o)}
            title={full ? 'Layer limit reached' : 'Add layer'}
          >
            <Plus size={14} /> Add <ChevronDown size={12} />
          </button>
          {open && (
            <div className="add-menu" onMouseLeave={() => setOpen(false)}>
              {props.addGroups.map((g) => (
                <div key={g.group} className="add-group">
                  <div className="add-group-label">{g.group}</div>
                  {g.items.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className="add-item"
                      onClick={() => { props.onAdd(it.id); setOpen(false); }}
                    >
                      {it.color && <i style={{ background: it.color }} />}
                      <span>
                        <b>{it.label}</b>
                        <small>{it.sub}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {props.items.length === 0 && <div className="stack-empty">{props.emptyText}</div>}

      <ol className="stack-list">
        {props.items.map((it, i) => (
          <li
            key={it.id}
            draggable
            onDragStart={onDragStart(i)}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
            onDragLeave={() => setOverIdx((o) => (o === i ? null : o))}
            onDrop={onDrop(i)}
            onDragEnd={() => { setDragFrom(null); setOverIdx(null); }}
            className={[
              'stack-row',
              props.selected === it.id ? 'selected' : '',
              it.enabled ? '' : 'disabled',
              overIdx === i && dragFrom !== null && dragFrom !== i ? (dragFrom > i ? 'drop-above' : 'drop-below') : '',
            ].join(' ')}
            onClick={() => props.onSelect(it.id)}
          >
            <span className="grip" aria-hidden><GripVertical size={13} /></span>
            <span className="stack-index">{String(i + 1).padStart(2, '0')}</span>
            <span className="stack-thumb">
              {it.thumb ? <img src={it.thumb} alt="" draggable={false} /> : <span className="thumb-empty" />}
            </span>
            <span className="stack-meta">
              <b>{it.name}</b>
              <small>{it.sub}</small>
              {it.badge && <em>{it.badge}</em>}
            </span>
            <button
              type="button"
              className="row-btn"
              title={it.enabled ? 'Disable' : 'Enable'}
              onClick={(e) => { e.stopPropagation(); props.onToggle(it.id, !it.enabled); }}
            >
              {it.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button
              type="button"
              className="row-btn danger"
              title="Delete layer"
              onClick={(e) => { e.stopPropagation(); props.onDelete(it.id); }}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
