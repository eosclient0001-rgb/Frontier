// Small DOM helpers for the editor panes. No framework: panes are rebuilt from state on discrete changes.

type Child = Node | string | null | false | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "text") el.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === "value") (el as HTMLInputElement).value = String(value);
    else if (key === "checked") (el as HTMLInputElement).checked = Boolean(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function field(label: string, control: Node): HTMLElement {
  return h("label", { class: "field" }, h("span", { text: label }), control);
}

export function numberInput(value: number, onChange: (v: number) => void, step = 1, min?: number, max?: number): HTMLInputElement {
  const input = h("input", { type: "number", step: String(step), value: round(value), min, max });
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return input;
}

export function textInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = h("input", { type: "text", value });
  input.addEventListener("change", () => onChange(input.value.trim()));
  return input;
}

export function select<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const el = h("select", {}, ...options.map(([v, label]) => h("option", { value: v, text: label, selected: v === value })));
  el.value = value;
  el.addEventListener("change", () => onChange(el.value as T));
  return el;
}

export function check(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox", checked });
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "check" }, input, h("span", { text: label }));
}

export function tile(glyph: string, label: string, pressed: boolean, onClick: () => void, wide = false): HTMLElement {
  return h(
    "button",
    { class: wide ? "tile wide" : "tile", "aria-pressed": String(pressed), onclick: onClick, title: label },
    h("span", { class: "glyph", text: glyph }),
    h("span", { class: "label", text: label })
  );
}

export function button(text: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  return h("button", { class: cls, text, onclick: onClick, type: "button" });
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "section" }, h("h3", { text: title }), ...children);
}

export function round(v: number, digits = 2): string {
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

let toastTimer = 0;
export function toast(text: string): void {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2400);
}

export function download(name: string, data: Blob | string, type = "application/octet-stream"): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
