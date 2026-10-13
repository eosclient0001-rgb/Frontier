// DOM HUD: speedometer, clock, score, nitro, toasts, overlays and a route-aware minimap.
import { ROAD } from '../world/constants.js';

const MAP_SCALE = 1.25; // px per metre
const MAP_RANGE = 380; // metres around the car

export class HUD {
  constructor(doc = document) {
    this.doc = doc;
    const q = (id) => doc.getElementById(id);
    this.el = {
      speed: q('speed'),
      clock: q('clock'),
      score: q('score'),
      dist: q('dist'),
      nitro: q('nitro-fill'),
      drift: q('drift'),
      toasts: q('toasts'),
      menu: q('menu'),
      pause: q('pause'),
      over: q('over'),
      overStats: q('over-stats'),
      hud: q('hud'),
      map: q('minimap'),
      cam: q('cam-label'),
      mute: q('mute-label'),
    };
    this.ctx = this.el.map ? this.el.map.getContext('2d') : null;
    this.mapTimer = 0;
    this.lastClock = null;
  }

  showOverlay(name) {
    for (const k of ['menu', 'pause', 'over']) this.el[k].classList.toggle('show', k === name);
    this.el.hud.classList.toggle('show', name === null);
  }

  setCamLabel(text) {
    if (this.el.cam) this.el.cam.textContent = text;
  }

  setMuteLabel(muted) {
    if (this.el.mute) this.el.mute.textContent = muted ? 'Sound off' : 'Sound on';
  }

  toast(text, tone = 'info') {
    const d = this.doc.createElement('div');
    d.className = 'toast ' + tone;
    d.textContent = text;
    this.el.toasts.prepend(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 1600);
    setTimeout(() => d.remove(), 2400);
  }

  update(game, dt) {
    const e = this.el;
    const kmh = Math.round(game.speedKmh);
    e.speed.textContent = String(kmh).padStart(3, ' ');
    const secs = Math.ceil(game.clock);
    if (secs !== this.lastClock) {
      this.lastClock = secs;
      e.clock.textContent = secs.toString();
      e.clock.classList.toggle('low', secs <= 10);
    }
    e.score.textContent = game.score.toLocaleString('en-GB');
    e.dist.textContent = (game.dist / 1000).toFixed(2) + ' km';
    e.nitro.style.transform = `scaleX(${game.vehicle.nitroLeft.toFixed(3)})`;
    e.drift.classList.toggle('show', game.drifting && game.driftTime > 0.4);
    if (game.drifting && game.driftTime > 0.4) e.drift.textContent = 'DRIFT ' + Math.round(game.driftScore);
    this.mapTimer -= dt;
    if (this.ctx && this.mapTimer <= 0) {
      this.mapTimer = 0.1;
      this.drawMap(game);
    }
  }

  showOver(game) {
    const fmt = (n) => n.toLocaleString('en-GB');
    this.el.overStats.innerHTML = [
      ['Score', fmt(game.score)],
      ['Distance', (game.dist / 1000).toFixed(2) + ' km'],
      ['Top speed', Math.round(game.stats.maxSpeed * 3.6) + ' km/h'],
      ['Checkpoints', String(game.checkpoints)],
      ['Near misses', String(game.nearMisses)],
    ]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
      .join('');
  }

  drawMap(game) {
    const c = this.ctx;
    const W = this.el.map.width;
    const H = this.el.map.height;
    const v = game.vehicle;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(8, 14, 22, 0.55)';
    c.beginPath();
    c.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.beginPath();
    c.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    c.clip();

    // car frame: forward is up on the map
    const fx = Math.cos(v.yaw);
    const fz = Math.sin(v.yaw);
    const rx = -fz;
    const rz = fx;
    const toMap = (x, z) => {
      const dx = x - v.x;
      const dz = z - v.z;
      return [W / 2 + (dx * rx + dz * rz) * MAP_SCALE, H / 2 - (dx * fx + dz * fz) * MAP_SCALE];
    };

    // roads (the centre line; the carriageway is drawn wider)
    for (const sec of game.route.sections) {
      const cull = sec.dist0 > game.playerDist + MAP_RANGE + 200 || sec.dist0 + sec.len < game.playerDist - MAP_RANGE;
      if (cull) continue;
      c.lineCap = 'round';
      c.strokeStyle = sec.elev > 0 ? 'rgba(170, 186, 204, 0.9)' : 'rgba(120, 136, 152, 0.85)';
      c.lineWidth = Math.max(2, ROAD.OUTER * 2 * MAP_SCALE * 0.55);
      c.beginPath();
      for (let i = 0; i < sec.n; i += 4) {
        const [mx, my] = toMap(sec.px[i], sec.pz[i]);
        if (i === 0) c.moveTo(mx, my);
        else c.lineTo(mx, my);
      }
      c.stroke();
      if (sec.monorail) {
        c.strokeStyle = 'rgba(230, 240, 248, 0.9)';
        c.lineWidth = 1.2;
        c.setLineDash([3, 3]);
        c.beginPath();
        for (let i = 0; i < sec.n; i += 4) {
          const [mx, my] = toMap(sec.px[i], sec.pz[i]);
          if (i === 0) c.moveTo(mx, my);
          else c.lineTo(mx, my);
        }
        c.stroke();
        c.setLineDash([]);
      }
    }

    // rail lines and gates
    for (const r of game.route.rails) {
      const [ax, ay] = toMap(r.seg.x0, r.seg.z0);
      const [bx, by] = toMap(r.seg.x1, r.seg.z1);
      c.strokeStyle = r.kind === 'ground' ? 'rgba(255, 196, 80, 0.9)' : 'rgba(200, 220, 240, 0.5)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(bx, by);
      c.stroke();
    }

    // traffic
    c.fillStyle = 'rgba(230, 236, 242, 0.85)';
    for (const a of game.traffic.agents) {
      if (a.kind !== 'car') continue;
      const [mx, my] = toMap(a.x, a.z);
      if (Math.abs(mx - W / 2) > W / 2 || Math.abs(my - H / 2) > H / 2) continue;
      c.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }
    // trains on the map
    for (const t of game.crossTrains.trains) {
      const pose = game.crossTrains.pose(t);
      const [mx, my] = toMap(pose.x, pose.z);
      c.fillStyle = 'rgba(255, 196, 80, 0.95)';
      c.fillRect(mx - 3, my - 3, 6, 6);
    }

    c.restore();
    // player arrow
    c.save();
    c.translate(W / 2, H / 2);
    c.fillStyle = '#f4f8fb';
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 6);
    c.lineTo(0, 3);
    c.lineTo(-5, 6);
    c.closePath();
    c.fill();
    c.restore();
  }
}
