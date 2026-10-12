import type { RoadNetwork } from './types';

/**
 * Snapshot-based undo/redo. Road networks are small JSON documents, so storing
 * whole snapshots is simpler and more robust than per-operation inverses.
 */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(private readonly limit = 200) {}

  /** Call before mutating the network. */
  record(net: RoadNetwork): void {
    this.past.push(JSON.stringify(net));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: RoadNetwork): RoadNetwork | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(prev) as RoadNetwork;
  }

  redo(current: RoadNetwork): RoadNetwork | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(next) as RoadNetwork;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
