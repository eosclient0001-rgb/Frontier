export function isTextEditing(element) {
  return (
    !!element &&
    (element.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
  );
}
export function gizmoShortcut(
  event,
  { flying = false, typing = false, dragging = false } = {},
) {
  if (
    flying ||
    typing ||
    dragging ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return null;
  return { KeyG: "move", KeyR: "rotate", KeyS: "scale" }[event.code] || null;
}
