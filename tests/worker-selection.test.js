import test from "node:test";
import assert from "node:assert/strict";
import { FieldWorker } from "../src/field-worker.js";
import {
  SELECTION_VOXELS as N,
  validSelectionResult,
} from "../src/selection-result.js";
import { GPUErosion } from "../src/gpu-erosion.js";
import { selectIntactCell } from "../src/intact-fracture.js";
import { selectConnectedChunk } from "../src/fractures.js";
const result = () => {
  const mask = new Uint8Array(N);
  mask[1] = 255;
  return { mask, count: 1, total: 10, fraction: 0.1, whole: false };
};
class MockWorker {
  constructor(handler) {
    this.handler = handler;
    this.messages = [];
  }
  postMessage(message) {
    this.messages.push(message);
    queueMicrotask(() =>
      this.onmessage({ data: { id: message.id, ...this.handler(message) } }),
    );
  }
  terminate() {
    this.terminated = true;
  }
}
test("old worker returning volume instead of mask is replaced once; the exact edited snapshot is adopted and retried", async () => {
  const workers = [],
    volume = new Float32Array(N * 4);
  volume[20] = -3.25;
  const client = new FieldWorker(() => {
    const index = workers.length,
      w = new MockWorker((m) =>
        index === 0
          ? { volume: new Float32Array(4) }
          : m.type === "restore"
            ? { restored: true }
            : result(),
      );
    workers.push(w);
    return w;
  });
  const pattern = { intact: true },
    selected = await client.request("selectIntactCell", {
      volume,
      point: [0, 1, 0],
      pattern,
    });
  assert.ok(validSelectionResult(selected));
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(
    workers[1].messages.map((m) => m.type),
    ["restore", "selectIntactCell"],
  );
  assert.equal(workers[1].messages[0].volume, volume);
  assert.equal(workers[1].messages[1].pattern, pattern);
  assert.equal(volume[20], -3.25);
  assert.equal(client.pending.size, 0);
});
test("corrupt mask/stats never become a selection and recovery is bounded", async () => {
  let created = 0;
  const client = new FieldWorker(() => {
    created++;
    return new MockWorker((m) =>
      m.type === "restore" ? { restored: true } : { ...result(), count: 7 },
    );
  });
  await assert.rejects(
    client.request("selectChunk", { volume: new Float32Array(N * 4) }),
    /could not be selected safely/,
  );
  assert.equal(created, 2);
  assert.equal(client.pending.size, 0);
  assert.equal(validSelectionResult({ volume: [] }), false);
});
test("invalid inputs and ordinary selection errors do not trigger recovery", async () => {
  let created = 0;
  const client = new FieldWorker(() => {
    created++;
    return new MockWorker(() => ({
      error: "Click inside the marked crack region.",
    }));
  });
  await assert.rejects(
    client.request("selectIntactCell", {}),
    /snapshot is unavailable/,
  );
  await assert.rejects(
    client.request("selectIntactCell", { volume: new Float32Array(N * 4) }),
    /Click inside/,
  );
  assert.equal(created, 1);
  assert.equal(client.pending.size, 0);
});
test("GPU refuses a missing mask, clears stale highlighting, and never bakes on an invalid deletion", async () => {
  const solver = Object.create(GPUErosion.prototype);
  solver.chunkSelected = true;
  let baked = 0;
  solver.bakeSplineCuts = () => baked++;
  assert.throws(
    () => solver.setChunkSelection(undefined),
    /No valid piece selection/,
  );
  assert.equal(solver.chunkSelected, false);
  await assert.rejects(solver.deleteChunk(), /Select a fracture piece/);
  assert.equal(baked, 0);
  assert.throws(
    () => selectConnectedChunk(undefined, [0, 0, 0]),
    /Invalid chunk selection/,
  );
  const pattern = {
    intact: true,
    sites: [
      [0, 0, 0],
      [1, 0, 0],
    ],
    brushes: [{ a: [0, 0, 0], b: [0, 1, 0], radius: 2 }],
  };
  assert.throws(
    () => selectIntactCell(undefined, [0, 0, 0], pattern),
    /Invalid intact fracture/,
  );
});
test("worker explicitly rejects unsupported messages instead of falling through to a volume reply", async () => {
  const previous = globalThis.self,
    replies = [];
  globalThis.self = { postMessage: (m) => replies.push(m) };
  try {
    await import("../src/worker.js");
    self.onmessage({ data: { id: 33, type: "outdated-operation" } });
    assert.equal(replies[0].code, "UNKNOWN_REQUEST");
    assert.equal(replies[0].id, 33);
    assert.equal(replies[0].mask, undefined);
    assert.equal(replies[0].volume, undefined);
  } finally {
    if (previous === undefined) delete globalThis.self;
    else globalThis.self = previous;
  }
});
