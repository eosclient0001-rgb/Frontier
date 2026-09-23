// Presentation-only interactions. Geometry and simulation remain owned by the editor.
const $ = (s) => document.querySelector(s);
const dialog = $("#new-scene-dialog");
$("#new-scene").addEventListener("click", () => {
  window.dispatchEvent(new Event("editor-modal"));
  dialog.showModal();
});
for (const id of ["close-new-scene", "cancel-new-scene"])
  $("#" + id).onclick = () => dialog.close();
dialog.addEventListener(
  "click",
  (event) => {
    const choice = event.target.closest(".scene-choice");
    if (choice && !choice.disabled) dialog.close();
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  },
  { capture: true },
);
const menu = $("#add-menu");
// Focus only when the user opens the popover, not while an embedded page loads.
menu.addEventListener("toggle", (event) => {
  if (event.newState === "open") $("#add-shape").focus({ preventScroll: true });
});
menu.addEventListener("beforetoggle", (event) => {
  if (event.newState !== "open") return;
  const r = $("#add-object").getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - 288)) + "px";
  menu.style.top = Math.min(r.bottom + 8, innerHeight - 230) + "px";
});
menu.addEventListener(
  "click",
  (event) => {
    if (event.target.closest("button:not(:disabled)")) menu.hidePopover();
  },
  { capture: true },
);
window.addEventListener("resize", () => {
  if (menu.matches(":popover-open")) menu.hidePopover();
});
// Roving focus for the one inspector tab group; no duplicate navigation.
$(".tab-list").addEventListener("keydown", (event) => {
  if (
    ![
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ].includes(event.key)
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  const tabs = [...$(".tab-list").querySelectorAll(".tab")];
  const index = tabs.indexOf(document.activeElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index +
            (["ArrowRight", "ArrowDown"].includes(event.key)
              ? 1
              : tabs.length - 1)) %
          tabs.length;
  tabs[next].focus();
});
function fill(range) {
  const progress =
    (100 * (Number(range.value) - Number(range.min))) /
    (Number(range.max) - Number(range.min));
  range.style.setProperty(
    "--range-progress",
    `${Math.max(0, Math.min(100, progress))}%`,
  );
}
// Value pills are also precise numeric inputs. Commit with Enter/blur, cancel with Escape.
for (const range of document.querySelectorAll("input[type=range]")) {
  fill(range);
  range.addEventListener("input", () => fill(range));
  const output = document.getElementById(range.id + "-value");
  if (!output) continue;
  const label = range.closest(".control")?.querySelector("label");
  const name =
    label?.textContent.replace(output.textContent, "").trim() || range.id;
  output.tabIndex = 0;
  output.setAttribute("role", "button");
  output.setAttribute("aria-label", `Edit ${name}`);
  output.title = "Click to enter an exact value";
  const disabled = () => {
    output.setAttribute("aria-disabled", String(range.disabled));
    output.tabIndex = range.disabled ? -1 : 0;
  };
  new MutationObserver(disabled).observe(range, {
    attributes: true,
    attributeFilter: ["disabled"],
  });
  disabled();
  function edit() {
    if (range.disabled || output.querySelector("input")) return;
    const old = output.textContent,
      field = document.createElement("input");
    const units =
      range.id === "waveHeight" ||
      range.id === "fracture-variation" ||
      range.id === "rainEvaporation" ||
      range.id === "runoffEvaporation" ||
      (range.id.startsWith("satmap") && range.id !== "satmapScale")
        ? 100
        : range.id === "fracture-width" && Number(range.max) <= 0.08
          ? 1000
          : 1;
    field.type = "number";
    field.className = "value-editor";
    field.value = Number(range.value) * units;
    field.min = Number(range.min) * units;
    field.max = Number(range.max) * units;
    field.step = (Number(range.step) || 1) * units;
    field.setAttribute("aria-label", name);
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const v = Number(field.value) / units,
        min = Number(range.min),
        max = Number(range.max),
        step = Number(range.step) || 1;
      output.textContent = old;
      if (
        commit &&
        field.value !== "" &&
        Number.isFinite(v) &&
        !range.disabled
      ) {
        range.value = String(
          Math.min(
            max,
            Math.max(
              min,
              Number((Math.round((v - min) / step) * step + min).toFixed(6)),
            ),
          ),
        );
        range.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };
    field.addEventListener("blur", () => finish(true));
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        finish(event.key === "Enter");
        output.focus();
      }
    });
    output.replaceChildren(field);
    field.focus();
    field.select();
  }
  output.addEventListener("click", edit);
  output.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      edit();
    }
  });
}

// Small context menus replace permanently exposed control strips.
for (const [triggerId, menuId] of [["viewport-options", "view-menu"]]) {
  const trigger = document.getElementById(triggerId),
    popup = document.getElementById(menuId);
  popup.addEventListener("beforetoggle", (event) => {
    trigger.setAttribute("aria-expanded", String(event.newState === "open"));
    if (event.newState !== "open") return;
    const rect = trigger.getBoundingClientRect();
    popup.style.left =
      Math.max(8, Math.min(rect.right - 216, innerWidth - 224)) + "px";
    popup.style.top =
      Math.max(8, Math.min(rect.bottom + 6, innerHeight - 244)) + "px";
  });
  popup.addEventListener("toggle", (event) => {
    if (event.newState === "open")
      (
        popup.querySelector(".active") || popup.querySelector("button")
      )?.focus();
  });
  popup.addEventListener(
    "click",
    (event) => {
      if (event.target.closest("button:not(:disabled)")) popup.hidePopover();
    },
    { capture: true },
  );
  window.addEventListener("resize", () => {
    if (popup.matches(":popover-open")) popup.hidePopover();
  });
}

// Filtering only affects the outliner view, never object visibility or geometry.
const search = document.querySelector("#scene-search");
const tree = document.querySelector("#scene-tree");
function filterTree() {
  const query = search.value.trim().toLocaleLowerCase();
  let matches = 0;
  for (const row of tree.querySelectorAll(".outliner-row")) {
    const match = row
      .querySelector(".tree-name")
      .textContent.toLocaleLowerCase()
      .includes(query);
    row.classList.toggle("hidden", !match);
    if (match) matches++;
  }
  for (const group of tree.querySelectorAll(".outliner-group"))
    group.classList.toggle(
      "hidden",
      !group.querySelector(".outliner-row:not(.hidden)"),
    );
  document
    .querySelector("#scene-search-empty")
    .classList.toggle("hidden", !query || matches > 0);
}
search.addEventListener("input", filterTree);
search.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    search.value = "";
    filterTree();
    event.stopPropagation();
  }
});
new MutationObserver(filterTree).observe(tree, {
  childList: true,
  subtree: true,
});
