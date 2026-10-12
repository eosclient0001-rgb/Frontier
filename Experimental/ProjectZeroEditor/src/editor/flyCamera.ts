import * as THREE from 'three';

/**
 * Unreal-style editor camera.
 *
 *   W / S         fly forward / back along the view direction
 *   A / D         strafe left / right
 *   E / Q         fly up / down (world Y)
 *   Right mouse   hold and drag to look around
 *   Mouse wheel   change base fly speed
 *   Shift         x4 speed    Ctrl  x0.25 speed
 */
export class FlyCamera {
  yaw = Math.PI;
  pitch = -0.6;
  /** Base speed in metres per second. */
  speed = 120;
  private readonly keys = new Set<string>();
  private looking = false;
  private lastX = 0;
  private lastY = 0;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly cleanups: Array<() => void> = [];

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    this.applyRotation();
    const onDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      this.looking = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.dom.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!this.looking) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * 0.0035;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.0035));
      this.applyRotation();
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      this.looking = false;
      if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.speed = Math.max(5, Math.min(5000, this.speed * Math.pow(1.15, e.deltaY < 0 ? 1 : -1)));
    };
    const onContext = (e: Event) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => {
      this.keys.clear();
      this.looking = false;
    };

    this.dom.addEventListener('pointerdown', onDown);
    this.dom.addEventListener('pointermove', onMove);
    this.dom.addEventListener('pointerup', onUp);
    this.dom.addEventListener('wheel', onWheel, { passive: false });
    this.dom.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.cleanups.push(
      () => this.dom.removeEventListener('pointerdown', onDown),
      () => this.dom.removeEventListener('pointermove', onMove),
      () => this.dom.removeEventListener('pointerup', onUp),
      () => this.dom.removeEventListener('wheel', onWheel),
      () => this.dom.removeEventListener('contextmenu', onContext),
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
    );
  }

  dispose(): void {
    for (const c of this.cleanups) c();
  }

  /** True while right mouse look is in progress (editor tools ignore clicks then). */
  get isLooking(): boolean {
    return this.looking;
  }

  /** Puts the camera a fixed distance above and behind `target` looking down. */
  frame(target: THREE.Vector3, radius: number): void {
    this.pitch = -0.9;
    this.applyRotation();
    const back = this.forward.clone().multiplyScalar(-1);
    const dist = Math.max(40, radius * 1.4);
    this.camera.position.copy(target).addScaledVector(back, dist);
    this.speed = Math.max(20, radius * 0.6);
  }

  update(dt: number): void {
    this.applyRotation();
    let boost = 1;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) boost *= 4;
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) boost *= 0.25;
    const step = this.speed * boost * dt;

    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(this.forward);
    if (this.keys.has('KeyS')) move.sub(this.forward);
    if (this.keys.has('KeyD')) move.add(this.right);
    if (this.keys.has('KeyA')) move.sub(this.right);
    if (this.keys.has('KeyE')) move.add(this.up);
    if (this.keys.has('KeyQ')) move.sub(this.up);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(step);
      this.camera.position.add(move);
    }
  }

  private applyRotation(): void {
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.up).normalize();
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
