import { SELECTION_VOXELS, validSelectionResult } from "./selection-result.js";

// Keep Worker construction statically analyzable by Vite (including production).
const createWorker = () =>
  new Worker(new URL("./worker.js?selection-protocol=2", import.meta.url), {
    type: "module",
  });
const isSelection = (type) =>
  type === "selectChunk" || type === "selectIntactCell";
export class FieldWorker {
  constructor(factory = createWorker) {
    this.factory = factory;
    this.next = 0;
    this.pending = new Map();
    this.recovery = null;
    this.start();
  }
  start() {
    const worker = this.factory();
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker) return;
      const p = this.pending.get(data?.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) {
        const error = new Error(data.error);
        error.code = data.code;
        p.reject(error);
      } else p.resolve(data);
    };
    worker.onerror = (e) => {
      if (this.worker !== worker) return;
      this.rejectPending(
        new Error(e.message || "Background terrain worker failed."),
      );
    };
  }
  rejectPending(error) {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
  send(type, values) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, type, ...values });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async recover(volume) {
    if (!this.recovery) {
      this.recovery = (async () => {
        this.worker.terminate();
        this.rejectPending(
          new Error(
            "Background worker refreshed; retry this operation. No terrain was regenerated.",
          ),
        );
        this.start();
        // Adopt the authoritative current snapshot, never regenerate from preset.
        const restored = await this.send("restore", { volume });
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
  async request(type, values = {}) {
    if (this.recovery) await this.recovery;
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
