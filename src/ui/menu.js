/**
 * Frontier Terrain Forge — pop-up menus.
 *
 * The editor prototype uses a single floating panel for "add object" and for
 * row actions; this is the same idea: one element in the DOM, positioned at the
 * pointer, dismissed on the next outside click.
 */
import { el, clear, icon } from './dom.js';

let host = null;
let current = null;

function ensureHost() {
  if (!host) {
    host = el('div', { class: 'menu', hidden: true });
    document.body.append(host);
  }
  return host;
}

export function closeMenu() {
  if (!host) return;
  host.hidden = true;
  clear(host);
  current = null;
}

/**
 * @param {{x:number,y:number}} at   pointer position
 * @param {{title?:string, items:Array<{label, hint, icon, onClick, disabled, dividerBefore}>}} spec
 */
export function openMenu(at, spec) {
  const node = ensureHost();
  clear(node);
  if (spec.title) node.append(el('p', { text: spec.title }));
  for (const item of spec.items || []) {
    if (item.dividerBefore) node.append(el('hr'));
    node.append(el('button', {
      disabled: item.disabled || false,
      title: item.title,
      onclick: () => { closeMenu(); item.onClick?.(); },
    },
      item.icon ? icon(item.icon, 14) : null,
      el('span', { text: item.label }),
      item.hint ? el('small', { text: item.hint }) : null,
    ));
  }
  node.hidden = false;
  node.style.left = '0px';
  node.style.top = '0px';
  const rect = node.getBoundingClientRect();
  const x = Math.min(at.x, window.innerWidth - rect.width - 12);
  const y = Math.min(at.y, window.innerHeight - rect.height - 12);
  node.style.left = `${Math.max(12, x)}px`;
  node.style.top = `${Math.max(12, y)}px`;
  current = spec;
  return node;
}

document.addEventListener('pointerdown', (event) => {
  if (!host || host.hidden) return;
  if (host.contains(event.target)) return;
  closeMenu();
});
window.addEventListener('blur', closeMenu);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
