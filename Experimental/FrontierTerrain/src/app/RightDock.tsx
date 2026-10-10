// Right dock: stage switch (Terrain -> Texture), undo/redo, the active layer
// stack, and the inspector for the selected layer.
import type { ReactNode } from 'react';
import { Undo2, Redo2, Mountain, Palette } from 'lucide-react';
import { LayerStack } from './Stack';
import type { StackItem, AddGroup } from './Stack';

export type Stage = 'terrain' | 'texture';

export function RightDock(props: {
  stage: Stage;
  setStage: (s: Stage) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  statusText: string;
  stackTitle: string;
  stackItems: StackItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, on: boolean) => void;
  onDelete: (id: string) => void;
  onMove: (from: number, to: number) => void;
  addGroups: AddGroup[];
  onAdd: (id: string) => void;
  maxItems?: number;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <aside className="dock">
      <header className="dock-top">
        <div className="stage-switch" role="tablist" aria-label="Workflow stage">
          <button
            type="button"
            role="tab"
            aria-selected={props.stage === 'terrain'}
            className={props.stage === 'terrain' ? 'active' : ''}
            onClick={() => props.setStage('terrain')}
          >
            <span className="step">1</span><Mountain size={13} /> Terrain
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={props.stage === 'texture'}
            className={props.stage === 'texture' ? 'active' : ''}
            onClick={() => props.setStage('texture')}
          >
            <span className="step">2</span><Palette size={13} /> Texture
          </button>
        </div>
        <div className="dock-actions">
          <button type="button" className="icon-btn" onClick={props.onUndo} disabled={!props.canUndo} title="Undo (Ctrl+Z)"><Undo2 size={14} /></button>
          <button type="button" className="icon-btn" onClick={props.onRedo} disabled={!props.canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={14} /></button>
        </div>
      </header>
      <div className="dock-status">{props.statusText}</div>
      <section className="dock-stack">
        <LayerStack
          title={props.stackTitle}
          eyebrow={props.stage === 'terrain' ? 'Generation stack · top runs first' : 'Texture stack · first enabled is base'}
          items={props.stackItems}
          selected={props.selected}
          onSelect={props.onSelect}
          onToggle={props.onToggle}
          onDelete={props.onDelete}
          onMove={props.onMove}
          addGroups={props.addGroups}
          onAdd={props.onAdd}
          maxItems={props.maxItems}
          emptyText={props.emptyText}
        />
      </section>
      <section className="dock-inspector">{props.children}</section>
    </aside>
  );
}
