// Outliner LEFT, viewport CENTER, properties/tools RIGHT at every size.
// Resizing and choosing tools must never hide or move either panel.
const app = document.querySelector("#app");
for (const side of ["outliner", "properties"]) {
  const button = document.querySelector(`#toggle-${side}`);
  app.classList.remove(`${side}-collapsed`);
  button.setAttribute("aria-expanded", "true");
  button.addEventListener("click", () => {
    const collapsed = app.classList.toggle(`${side}-collapsed`);
    button.setAttribute("aria-expanded", String(!collapsed));
  });
}
