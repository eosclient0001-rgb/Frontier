import { configureDomain, currentDomain } from "./domain.js";
import { SELECTION_VOXELS } from "./selection-result.js";
import { selectIntactCell } from "./intact-fracture.js";
import { selectConnectedChunk } from "./fractures.js";
import {
  generateVolume,
  simulateVolume,
  sculptVolume,
  raycastVolume,
} from "./field.js";
let volume;
self.onmessage = ({ data: m }) => {
  try {
    let lastProgress = -1;
    const progress = (value) => {
      if (value - lastProgress < 0.02 && value !== 1) return;
      lastProgress = value;
      self.postMessage({ id: m.id, progress: value });
    };
    if (
      ![
        "capabilities",
        "restore",
        "selectIntactCell",
        "selectChunk",
        "init",
        "step",
        "sculpt",
        "pick",
      ].includes(m.type)
    ) {
      self.postMessage({
        id: m.id,
        error: "Unsupported worker request: " + m.type,
        code: "UNKNOWN_REQUEST",
      });
      return;
    }
    if (m.type === "capabilities") {
      self.postMessage({
        id: m.id,
        protocol: 4,
        selectionVoxels: SELECTION_VOXELS,
        requests: ["init", "restore"],
      });
      return;
    }
    if (m.type === "restore") {
      if (m.params) configureDomain(m.params);
      if (
        !(m.volume instanceof Float32Array) ||
        m.volume.length !== SELECTION_VOXELS * 4
      )
        throw new Error("Invalid terrain snapshot for worker recovery.");
      volume = m.volume;
      self.postMessage({ id: m.id, restored: true });
      return;
    }
    if (m.type === "selectIntactCell") {
      if (m.params) configureDomain(m.params);
      const result = selectIntactCell(m.volume, m.point, m.pattern);
      self.postMessage({ id: m.id, ...result }, [result.mask.buffer]);
      return;
    }
    if (m.type === "selectChunk") {
      if (m.params) configureDomain(m.params);
      const result = selectConnectedChunk(m.volume, m.point);
      self.postMessage({ id: m.id, ...result }, [result.mask.buffer]);
      return;
    }
    if (m.type === "init") volume = generateVolume(m.params, progress);
    if (m.type === "step")
      for (let i = 0; i < (m.count || 1); i++)
        volume = simulateVolume(volume, m.params);
    if (m.type === "sculpt")
      volume = sculptVolume(volume, m.point, m.radius, m.tool);
    if (m.type === "pick") {
      self.postMessage({
        id: m.id,
        point: raycastVolume(volume, m.origin, m.direction),
      });
      return;
    }
    const copy = volume.slice();
    self.postMessage({ id: m.id, volume: copy, domain: currentDomain() }, [
      copy.buffer,
    ]);
  } catch (error) {
    self.postMessage({ id: m.id, error: error.message });
  }
};
