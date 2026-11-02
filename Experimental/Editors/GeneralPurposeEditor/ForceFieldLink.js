// The debug prototype is independent of this editor's wind document for now.
const observer = new MutationObserver(() => {
  const dialog = document.querySelector('[role="dialog"][aria-label="WindEditor"]');
  if (!dialog || dialog.querySelector('[data-field-debug-link]')) return;
  const heading = dialog.querySelector('h1');
  if (!heading) return;
  heading.textContent = 'Force Field / Wind';
  const link = document.createElement('a');
  link.dataset.fieldDebugLink = 'true';
  link.href = '../ForceFieldEditor/';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Open independent force-field debugger ↗';
  link.title = 'Prototype: fields are not synchronized with this editor';
  link.style.cssText = 'display:block;color:#77dae8;font-size:12px;margin-top:6px';
  heading.after(link);
});
observer.observe(document.body, { childList: true, subtree: true });
