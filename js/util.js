// Frontier SDF — small shared helpers (no dependencies).
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function el(tag, cls = "", html = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== "") e.innerHTML = html;
  return e;
}

export function fmt(n, digits = 1) {
  if (!isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(0);
  if (a >= 100) return n.toFixed(Math.min(digits, 1));
  if (a >= 1) return n.toFixed(Math.min(digits, 2));
  if (a >= 0.01) return n.toFixed(2);
  return n.toFixed(3);
}

export function fmtInt(n) {
  if (!isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function download(name, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

// Toast stack (top center of viewport).
let toastBox = null;
export function toast(msg, kind = "info", ms = 4200) {
  if (!toastBox) {
    toastBox = $("#toasts");
    if (!toastBox) {
      toastBox = el("div");
      toastBox.id = "toasts";
      document.body.appendChild(toastBox);
    }
  }
  const t = el("div", `toast ${kind}`, msg);
  toastBox.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 400);
  }, ms);
  while (toastBox.children.length > 4) toastBox.firstChild.remove();
}

export function hash2(x, y) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
