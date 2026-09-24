// Headless chase simulation: the hunter chases a prey sphere that gets
// teleported around; verifies it reaches, attacks and connects.
import { MeshStandardMaterial, Vector3 } from 'three';
import { buildSkeleton } from '../trex/js/skeleton.js';
import { Animator } from '../trex/js/animator.js';
import { Hunter } from '../trex/js/hunter.js';

export function simulate({ spots, seconds = 16, log = false }) {
  const s = buildSkeleton({ bone: new MeshStandardMaterial(), tooth: new MeshStandardMaterial() });
  const a = new Animator(s);
  const prey = { pos: new Vector3(), vel: new Vector3(), radius: 0.45, held: false };
  const h = new Hunter(a, s, prey);
  h.setEnabled(true);
  const events = [];
  h.on((ev, d) => events.push(`${ev}:${d.kind}`));
  const results = [];
  let nan = false;
  for (const spot of spots) {
    prey.pos.set(...spot).add(a.rigPos.clone().setY(0)); prey.vel.set(0, 0, 0);
    events.length = 0;
    let t = 0, firstHit = null, states = new Set();
    for (; t < seconds; t += 1 / 60) {
      h.update(1 / 60);
      a.update(1 / 60);
      // prey physics: gravity, bounce, friction
      if (!prey.held) {
        prey.vel.y -= 9.81 / 60;
        prey.pos.addScaledVector(prey.vel, 1 / 60);
        if (prey.pos.y < prey.radius) { prey.pos.y = prey.radius; prey.vel.y *= -0.4; prey.vel.x *= 0.9; prey.vel.z *= 0.9; }
      }
      states.add(h.state);
      if (isNaN(s.head.quaternion.w) || isNaN(a.rigPos.x)) nan = true;
      if (!firstHit && events.some((e) => e.startsWith('hit'))) firstHit = t;
      if (firstHit && t > firstHit + 2.5) break;
    }
    results.push({ spot, firstHit, events: [...events], states: [...states] });
    if (log) console.log(`prey @ ${spot.join(',')} → ${firstHit ? 'HIT at ' + firstHit.toFixed(1) + 's' : 'no hit'} | ${events.join(' ')} | ${[...states].join('>')}`);
  }
  return { results, nan };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  simulate({ log: true, spots: [[0, 0.45, -30], [3, 2.0, -8], [0, 0.45, -5.8], [4.5, 0.45, 2], [-4, 0.45, -1], [-15, 0.45, 10], [10, 2.5, -10]] });
}
