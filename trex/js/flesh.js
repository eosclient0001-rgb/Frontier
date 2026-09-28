/**
 * flesh.js — Optional soft-tissue envelope ("X-ray" / "Flesh" view modes).
 *
 * Built as overlapping ellipsoids attached to the SAME joints that carry the
 * bones, so the flesh follows every vertebra and leg segment with no skinning
 * weights needed.  Proportions follow the body-cross-section table in spec.js
 * (itself traced from Hartman's dorsal + lateral skeletal views) and the
 * hindlimb musculature reconstruction of Hutchinson et al. 2005 (massive
 * caudofemoralis at the tail base, thick thigh, slender shank).
 */

import { Mesh, Vector3, Object3D } from 'three';
import { ellipsoidGeom, tubeGeometry, mergeGeoms, transformGeom, roughenGeometry } from './geo.js';
import { profileAt, SPEC } from './spec.js';
import { LEG } from './skeleton.js';

export function buildFlesh(skel, mat) {
  const meshes = [];
  const add = (parent, geom, name) => {
    const m = new Mesh(geom, mat);
    m.name = name;
    m.castShadow = true;
    m.userData.flesh = true;
    parent.add(m);
    meshes.push(m);
    return m;
  };

  const items = skel.layout.items;
  const byName = {};
  for (const j of [...skel.trunk, ...skel.neck, ...skel.tail]) byName[j.name] = j;

  // ---- axial: one ellipsoid per joint, centred mid-centrum, offset so the
  //      vertebral column sits in the upper third of the body section
  for (const it of items) {
    const series = it.series;
    if (series === 'sacral') continue;
    const tag = series === 'dorsal' ? `D${it.index}` : series === 'cervical' ? `C${it.index}` : `Ca${it.index}`;
    const joint = byName[tag];
    if (!joint) continue;
    const [hw, hd, hv] = profileAt(series, it.index);
    const halfH = (hd + hv) / 2;
    const centreZ = (hd - hv) / 2 - halfH * 0.18 - (series === 'dorsal' ? 0.28 : series === 'cervical' ? 0.06 : 0.02);
    const alongY = series === 'caudal' ? -it.length / 2 : it.length / 2;
    // long, heavily overlapping segments → smooth continuous body wall
    const depth = series === 'dorsal' ? 1.42 : series === 'cervical' ? 1.12 : 1.05;
    const zShift = series === 'dorsal' ? -0.16 * Math.sin(Math.PI * (it.index - 1) / 12) : 0;
    const g = ellipsoidGeom(hw, it.length * 1.9, halfH * depth, 20);
    g.translate(0, alongY, centreZ + zShift);
    add(joint, g, `flesh ${tag}`);
  }
  // pelvis / sacral mass
  {
    const g = mergeGeoms([
      transformGeom(ellipsoidGeom(0.66, 0.78, 0.95, 20), { pos: [0, 0.05, 0.10] }),
    ]);
    add(skel.pelvis, g, 'flesh pelvis');
  }
  // head: fleshed skull (lips cover the teeth, per Cullen et al. 2023)
  {
    const g = mergeGeoms([
      transformGeom(ellipsoidGeom(0.47, 0.37, 0.50, 22), { pos: [0, 0.00, -0.08] }),
      transformGeom(ellipsoidGeom(0.36, 0.33, 0.50, 22), { pos: [0, -0.02, -0.52] }),
      transformGeom(ellipsoidGeom(0.23, 0.29, 0.46, 22), { pos: [0, -0.05, -0.93] }),
      transformGeom(ellipsoidGeom(0.16, 0.22, 0.24, 18), { pos: [0, -0.07, -1.17] }),
    ]);
    add(skel.head, g, 'flesh head');
    const jaw = mergeGeoms([
      transformGeom(ellipsoidGeom(0.30, 0.17, 0.72, 20), { pos: [0, -0.07, -0.68] }),
    ]);
    add(skel.jaw, jaw, 'flesh jaw');
  }

  // ---- hindlimbs
  for (const key of ['L', 'R']) {
    const leg = skel.legs[key];
    const s = key === 'R' ? 1 : -1;
    // thigh: caudofemoralis + iliotibialis bulk
    add(leg.femur, mergeGeoms([
      transformGeom(ellipsoidGeom(0.36, 0.78, 0.50, 20), { pos: [s * 0.02, -0.55, 0.06] }),
      transformGeom(ellipsoidGeom(0.30, 0.45, 0.40, 16), { pos: [s * 0.00, -0.12, 0.10] }),
    ]), `flesh thigh ${key}`);
    // shank: gastrocnemius bulge behind the tibia
    add(leg.tibia, mergeGeoms([
      transformGeom(ellipsoidGeom(0.20, 0.55, 0.26, 16), { pos: [0, -0.42, 0.06] }),
      transformGeom(ellipsoidGeom(0.12, 0.35, 0.13, 12), { pos: [0, -0.95, 0.03] }),
    ]), `flesh shank ${key}`);
    add(leg.meta, transformGeom(ellipsoidGeom(0.13, 0.38, 0.10, 12), { pos: [0, -0.34, 0.01] }), `flesh metatarsus ${key}`);
    // toe pads
    for (const d of Object.values(leg.digits)) {
      d.joints.forEach((j, k) => {
        const len = d.def.lengths[k];
        add(j, transformGeom(ellipsoidGeom(d.def.width * 1.5, d.def.width * 1.2, len * 0.62, 10), { pos: [0, -0.01, -len * 0.5] }), `flesh toe`);
      });
    }
  }
  // ---- arms
  for (const key of ['L', 'R']) {
    const a = skel.arms[key];
    if (!a || !a.shoulder) continue;
    add(a.shoulder, transformGeom(ellipsoidGeom(0.075, 0.24, 0.085, 12), { pos: [0, -0.18, 0] }), 'flesh arm');
    add(a.elbow, transformGeom(ellipsoidGeom(0.055, 0.17, 0.06, 10), { pos: [0, -0.14, 0] }), 'flesh forearm');
    add(a.wrist, transformGeom(ellipsoidGeom(0.04, 0.12, 0.045, 10), { pos: [0, -0.10, -0.02] }), 'flesh hand');
  }
  return meshes;
}
