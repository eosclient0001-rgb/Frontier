// Light Studio authors independent profiles; it does not change the selected scene light.
const LightLinkObserver = new MutationObserver(() => {
  const panels = document.querySelectorAll('.reference-inspector-copy[data-reference-kind="spotlight"], .reference-inspector-copy[data-reference-kind="ieslight"]');
  for (const panel of panels) {
    if (panel.querySelector('[data-light-studio-link]')) continue;
    const link = document.createElement('a');
    link.dataset.lightStudioLink = 'true';
    link.href = '../LightEditor/?mode=' + (panel.dataset.referenceKind === 'spotlight' ? 'spot' : 'ies');
    link.target = '_blank'; link.rel = 'noopener';
    link.textContent = 'Open Light Studio ↗';
    link.title = 'Author and export a separate profile; scene light properties are not synchronized.';
    link.style.cssText = 'display:block;margin:6px 12px 12px;padding:10px 14px;border:1px solid #51473f;border-radius:10px;background:#302b27;color:#e1c0a3;font:12px sans-serif;text-decoration:none';
    panel.prepend(link);
  }
});
LightLinkObserver.observe(document.body, {childList:true, subtree:true});
