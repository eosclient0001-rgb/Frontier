// Unreal-style fly camera: hold right mouse to look, WASD to move along the view direction, Q/E to descend and
// ascend, Shift to boost, and the wheel to change the base speed.

import { PerspectiveCamera, Vector3 } from "three";

export class FlyCamera {
  readonly camera: PerspectiveCamera;
  speed = 140; // [m/s]
  private yaw = 0.7;
  private pitch = -0.55;
  private looking = false;
  private keys = new Set<string>();

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new PerspectiveCamera(58, aspect, 0.5, 9000);
    this.camera.position.set(0, 420, 980);
    this.apply();

    window.addEventListener("keydown", (e) => {
      if (isTyping(e.target)) return;
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    dom.addEventListener("pointerdown", (e) => {
      if (e.button !== 2) return;
      this.looking = true;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointerup", (e) => {
      if (e.button === 2) this.looking = false;
    });
    dom.addEventListener("pointercancel", () => (this.looking = false));
    dom.addEventListener("pointermove", (e) => {
      if (!this.looking) return;
      this.yaw -= (e.movementX ?? 0) * 0.0028;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - (e.movementY ?? 0) * 0.0028));
      this.apply();
    });
    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.speed = Math.max(8, Math.min(900, this.speed * Math.pow(1.12, e.deltaY < 0 ? 1 : -1)));
      },
      { passive: false }
    );
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // Moves the camera so that it looks at a point, keeping the current view direction.
  lookAt(target: Vector3, distance = 260): void {
    const dir = new Vector3();
    this.camera.getWorldDirection(dir);
    this.camera.position.copy(target).addScaledVector(dir, -distance);
  }

  private apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  update(dt: number): void {
    const k = this.keys;
    const forward = new Vector3();
    this.camera.getWorldDirection(forward);
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const move = new Vector3();
    if (k.has("KeyW")) move.add(forward);
    if (k.has("KeyS")) move.sub(forward);
    if (k.has("KeyD")) move.add(right);
    if (k.has("KeyA")) move.sub(right);
    if (k.has("KeyE")) move.y += 1;
    if (k.has("KeyQ")) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize();
      const boost = k.has("ShiftLeft") || k.has("ShiftRight") ? 3.5 : 1;
      this.camera.position.addScaledVector(move, this.speed * boost * dt);
    }
    this.camera.position.y = Math.max(-40, this.camera.position.y);
  }
}

export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA");
}
