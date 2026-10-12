// Uniform hash grid over the ground plane. Used for segment crossings, node clustering and clearance queries.

interface GridCell<T> {
  ix: number;
  iz: number;
  items: T[];
}

export class SpatialGrid<T> {
  private cells = new Map<number, GridCell<T>>();

  constructor(readonly cellSize: number) {}

  private key(ix: number, iz: number): number {
    // Packs two signed cell indices into one safe integer key.
    return (ix + 1048576) * 2097152 + (iz + 1048576);
  }

  cellIndex(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  insertBox(minX: number, minZ: number, maxX: number, maxZ: number, item: T): void {
    const x0 = this.cellIndex(minX);
    const x1 = this.cellIndex(maxX);
    const z0 = this.cellIndex(minZ);
    const z1 = this.cellIndex(maxZ);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let cell = this.cells.get(k);
        if (!cell) {
          cell = { ix, iz, items: [] };
          this.cells.set(k, cell);
        }
        cell.items.push(item);
      }
    }
  }

  // Items whose cells overlap the query box. May contain duplicates; callers must tolerate them.
  queryBox(minX: number, minZ: number, maxX: number, maxZ: number, out: T[] = []): T[] {
    const x0 = this.cellIndex(minX);
    const x1 = this.cellIndex(maxX);
    const z0 = this.cellIndex(minZ);
    const z1 = this.cellIndex(maxZ);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.cells.get(this.key(ix, iz));
        if (cell) for (const item of cell.items) out.push(item);
      }
    }
    return out;
  }

  forEachCell(cb: (ix: number, iz: number, items: readonly T[]) => void): void {
    for (const cell of this.cells.values()) cb(cell.ix, cell.iz, cell.items);
  }
}

// Disjoint-set forest with path halving. Used to merge node candidates that fall within the merge radius.
export class DisjointSet {
  private parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}
