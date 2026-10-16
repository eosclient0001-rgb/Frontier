import Verify from "node:test";
import Assert from "node:assert/strict";
import { CommandProtocol, ValidateCommands } from "./CommandPacket.js";

const Packet = () => ({description: {figures: []}, frame: {
  width: 800, height: 600, view: {}, draws: [], clear: [0, 0, 0, 1], cpuFragments: 0, rgbaUploads: 0,
}});
Verify("Versioned handshake distinguishes this worker from the recovered CPU worker", () => {
  Assert.equal(CommandProtocol, "solidarc-gpu-commands-v1");
});
Verify("Actual command-shaped packet is accepted unchanged", () => {
  const Response = Packet();
  Assert.equal(ValidateCommands(Response), Response);
});
Verify("Legacy CPU response fails descriptively, not by reading undefined.cpuFragments", () => {
  Assert.throws(() => ValidateCommands({description: {figures: []}, pixels: new Uint8Array(4)}), /outdated CPU geometry worker/);
});
Verify("Service health JSON is never mistaken for a GPU frame", () => {
  Assert.throws(() => ValidateCommands({transport: "native-cpp-command-stream", raster: false}), /no GPU frame/);
});
Verify("Missing description or malformed extent is rejected before rendering", () => {
  const Response = Packet();
  delete Response.description;
  Assert.throws(() => ValidateCommands(Response), /no document description/);
  const Invalid = Packet();
  Invalid.frame.width = NaN;
  Assert.throws(() => ValidateCommands(Invalid), /incompatible GPU frame/);
});
Verify("CPU-raster counters cannot enter the GPU route", () => {
  const Response = Packet();
  Response.frame.cpuFragments = 1;
  Assert.throws(() => ValidateCommands(Response), /CPU raster fallback is disabled/);
});
