import { SELECTION_VOXELS, validSelectionResult } from "./selection-result.js";

// Keep Worker construction statically analyzable by Vite (including production).
// Vite strips query strings from new Worker(new URL(...)), so version the
// entry filenames, not just their queries. Both remain statically bundleable.
const createWorker = (fresh = false) =>
  fresh
    ? new Worker(new URL("./worker-recovery-v4.js", import.meta.url), {
        type: "module",
      })
    : new Worker(new URL("./worker-entry-v4.js", import.meta.url), {
        type: "module",
      });
const WORLD_PROTOCOL = 4;
const isSelection = (type) =>
  type === "selectChunk" || type === "selectIntactCell";
export class FieldWorker {
  constructor(factory = createWorker, options = {}) {
    this.options = options;
    this.factory = factory;
    this.next = 0;
    this.pending = new Map();
    this.recovery = null;
    this.start();
  }
  start(fresh = false) {
    this.worldProtocolReady = null;
    this.failure = null;
    let worker;
    try {
      worker = this.factory(fresh);
    } catch (error) {
      this.failure = error;
      return;
    }
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker) return;
      const p = this.pending.get(data?.id);
      if (!p) return;
      if (Number.isFinite(data.progress)) {
        this.options.onProgress?.({
          type: p.type,
          progress: Math.max(0, Math.min(1, data.progress)),
        });
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(data.id);
      if (data.error) {
        const error = new Error(data.error);
        error.code = data.code;
        p.reject(error);
      } else {
        if (
          ["init", "sculpt", "step"].includes(p.type) &&
          data.volume instanceof Float32Array
        )
          this.workerVolume = data.volume;
        if (p.type === "init") this.workerParams = p.values.params;
        if (p.type === "restore" && data.restored === true)
          this.workerVolume = p.values.volume;
        p.resolve(data);
      }
    };
    worker.onerror = (e) => {
      if (this.worker !== worker) return;
      this.failure = new Error(
        e.message || "Background terrain worker failed to load.",
      );
      this.rejectPending(this.failure);
    };
    worker.onmessageerror = () => {
      if (this.worker !== worker) return;
      this.failure = new Error(
        "Could not read the terrain worker response. Reload the preview.",
      );
      this.rejectPending(this.failure);
    };
  }
  rejectPending(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  send(type, values) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const ms =
        this.options.timeouts?.[type] ??
        { capabilities: 20000, world: 180000, init: 120000 }[type] ??
        60000;
      const timer = setTimeout(() => {
        const error = new Error(
          `Terrain worker timed out during ${type} after ${ms / 1000}s. Reload the preview or open it in a separate tab.`,
        );
        error.code = "WORKER_TIMEOUT";
        this.failure = error;
        this.worker?.terminate();
        this.rejectPending(error);
      }, ms);
      this.pending.set(id, { resolve, reject, type, values, timer });
      try {
        this.worker.postMessage({ id, type, ...values });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async recover(volume) {
    if (!this.recovery) {
      this.recovery = (async () => {
        this.worker?.terminate();
        this.rejectPending(
          new Error(
            "Background worker refreshed; retry this operation. No terrain was regenerated.",
          ),
        );
        this.start(true);
        // Adopt the authoritative current snapshot, never regenerate from preset.
        if (!volume) return; // Startup has no editable volume to adopt yet.
        const restored = await this.send("restore", {
          volume,
          params: this.workerParams,
        });
        if (restored.restored !== true)
          throw new Error(
            "Could not refresh piece selection safely. No rock was removed.",
          );
      })();
    }
    const recovery = this.recovery;
    try {
      await recovery;
    } finally {
      if (this.recovery === recovery) this.recovery = null;
    }
  }
  async ensureWorldProtocol() {
    if (!this.worldProtocolReady) {
      const valid = (r) =>
        r?.protocol === WORLD_PROTOCOL &&
        r?.selectionVoxels === SELECTION_VOXELS &&
        ["init", "restore"].every((name) => r?.requests?.includes(name));
      const probe = async () => {
        try {
          return valid(await this.send("capabilities", {}));
        } catch (error) {
          if (
            error.code === "UNKNOWN_REQUEST" ||
            error.code === "WORKER_TIMEOUT" ||
            /Unsupported worker request/.test(error.message)
          )
            return false;
          throw error;
        }
      };
      this.worldProtocolReady = (async () => {
        if (await probe()) return;
        // Domain handshake requests can refresh the worker, but preserve its
        // current CPU volume for manual sculpt/pick fallback when it has one.
        await this.recover(this.workerVolume);
        if (!(await probe()))
          throw new Error(
            "Terrain worker is out of date. Reload the preview to load the kilometre workspace. No terrain was regenerated.",
          );
      })();
      const ready = this.worldProtocolReady;
      await ready;
      // start() clears readiness during recovery; retain the successful probe.
      this.worldProtocolReady = ready;
    }
    await this.worldProtocolReady;
  }
  async request(type, values = {}) {
    if (this.recovery) await this.recovery;
    if (type === "init" && values.params?.worldEnabled)
      await this.ensureWorldProtocol();
    if (!isSelection(type)) return this.send(type, values);
    if (
      !(values.volume instanceof Float32Array) ||
      values.volume.length !== SELECTION_VOXELS * 4
    )
      throw new Error(
        "The current terrain snapshot is unavailable. No rock was removed; select the piece again.",
      );
    let result;
    try {
      result = await this.send(type, values);
    } catch (error) {
      // Older workers may not know intact selection at all. Real selection
      // errors (e.g. clicking outside paint) are not retried or hidden.
      if (
        error.code !== "UNKNOWN_REQUEST" &&
        !/Cannot read properties of undefined|Unsupported worker request/.test(
          error.message,
        )
      )
        throw error;
    }
    if (validSelectionResult(result)) return result;
    // Old workers fell through and returned {volume}, without a mask. Refresh
    // once and retry with the SAME edited volume and fracture map.
    await this.recover(values.volume);
    const retry = await this.send(type, values);
    if (!validSelectionResult(retry))
      throw new Error(
        "The piece could not be selected safely. No rock was removed. Please retry selection.",
      );
    return retry;
  }
}
