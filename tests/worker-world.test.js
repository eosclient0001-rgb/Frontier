import test from "node:test";
import assert from "node:assert/strict";
import { FieldWorker } from "../src/field-worker.js";
import { SELECTION_VOXELS } from "../src/selection-result.js";
const capabilities = {
  protocol: 4,
  selectionVoxels: SELECTION_VOXELS,
  requests: ["init", "restore"],
};
class MockWorker {
  constructor(handler) {
    this.handler = handler;
    this.messages = [];
  }
  postMessage(m) {
    this.messages.push(m);
    queueMicrotask(() =>
      this.onmessage({ data: { id: m.id, ...this.handler(m) } }),
    );
  }
  terminate() {
    this.terminated = true;
  }
}
for (const legacy of ["unsupported", "old-shape", "wrong-grid"])
  test(`world startup replaces ${legacy} worker once before generating terrain`, async () => {
    const workers = [],
      freshFlags = [],
      params = { terrainWidth: 1000, worldEnabled: true };
    const client = new FieldWorker((fresh) => {
      freshFlags.push(fresh);
      const old = workers.length === 0;
      const worker = new MockWorker((m) => {
        if (old)
          return legacy === "unsupported"
            ? {
                error: "Unsupported worker request: " + m.type,
                code: "UNKNOWN_REQUEST",
              }
            : legacy === "old-shape"
              ? { volume: new Float32Array(4) }
              : { ...capabilities, selectionVoxels: 903168 };
        return m.type === "capabilities"
          ? capabilities
          : { volume: new Float32Array(4) };
      });
      workers.push(worker);
      return worker;
    });
    const r = await client.request("init", { params });
    assert.equal(r.volume.length, 4);
    assert.deepEqual(freshFlags, [false, true]);
    assert.equal(workers[0].terminated, true);
    assert.deepEqual(
      workers[1].messages.map((m) => m.type),
      ["capabilities", "init"],
    );
    assert.equal(workers[1].messages[1].params, params);
    await client.request("init", { params });
    assert.equal(workers.length, 2);
    assert.equal(workers[1].messages.at(-1).type, "init");
    assert.equal(client.pending.size, 0);
  });
test("protocol recovery retains the existing CPU fallback volume and never regenerates it", async () => {
  const workers = [],
    volume = new Float32Array(SELECTION_VOXELS * 4);
  volume[123] = -3.75;
  const client = new FieldWorker(() => {
    const old = workers.length === 0;
    const worker = new MockWorker((m) => {
      if (m.type === "init") return { volume };
      if (m.type === "capabilities")
        return old
          ? { error: "Unsupported worker request: capabilities" }
          : capabilities;
      if (m.type === "restore") return { restored: true };
      return { origin: [24, 8, 0] };
    });
    workers.push(worker);
    return worker;
  });
  await client.request("init", {});
  await client.ensureWorldProtocol();
  await client.request("pick", {});
  assert.deepEqual(
    workers[1].messages.map((m) => m.type),
    ["restore", "capabilities", "pick"],
  );
  assert.equal(workers[1].messages[0].volume, volume);
  assert.equal(volume[123], -3.75);
});
test("worker mismatch recovery is bounded and unrelated errors are not retried", async () => {
  let made = 0;
  const client = new FieldWorker(() => {
    made++;
    return new MockWorker(() => ({ protocol: 1 }));
  });
  await assert.rejects(
    client.request("init", { params: { worldEnabled: true } }),
    /out of date/,
  );
  assert.equal(made, 2);
  let others = 0;
  const broken = new FieldWorker(() => {
    others++;
    return new MockWorker(() => ({
      error: "Worker module could not be loaded",
    }));
  });
  await assert.rejects(
    broken.request("init", { params: { worldEnabled: true } }),
    /could not be loaded/,
  );
  assert.equal(others, 1);
});

test("silent worker requests time out, terminate the worker and clear pending work", async () => {
  let terminated = false;
  const client = new FieldWorker(
    () => ({
      postMessage() {},
      terminate() {
        terminated = true;
      },
    }),
    { timeouts: { init: 15 } },
  );
  await assert.rejects(
    client.request("init", {}),
    (e) => e.code === "WORKER_TIMEOUT" && /during init/.test(e.message),
  );
  assert.equal(terminated, true);
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.request("pick", {}), /timed out/);
});
test("worker construction and early load failures reject future requests instead of hanging", async () => {
  const broken = new FieldWorker(() => {
    throw new Error("Worker blocked by browser");
  });
  await assert.rejects(broken.request("init", {}), /blocked by browser/);
  let worker;
  const early = new FieldWorker(
    () => (worker = { postMessage() {}, terminate() {} }),
  );
  worker.onerror({ message: "Worker module failed before init" });
  await assert.rejects(early.request("init", {}), /before init/);
});
test("progress does not resolve requests early or overwrite the authoritative volume", async () => {
  let worker;
  const updates = [];
  const client = new FieldWorker(
    () =>
      (worker = {
        postMessage(m) {
          this.message = m;
        },
        terminate() {},
      }),
    { onProgress: (p) => updates.push(p) },
  );
  const pending = client.request("init", {}),
    id = worker.message.id;
  worker.onmessage({ data: { id, progress: 0.5 } });
  assert.equal(client.pending.size, 1);
  assert.equal(client.workerVolume, undefined);
  const volume = new Float32Array(4);
  worker.onmessage({ data: { id, volume } });
  assert.equal((await pending).volume, volume);
  assert.equal(client.pending.size, 0);
  assert.deepEqual(updates, [{ type: "init", progress: 0.5 }]);
});
