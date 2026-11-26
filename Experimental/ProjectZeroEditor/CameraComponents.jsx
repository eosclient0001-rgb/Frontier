//============================================================================================================================================
//                                                          CAMERACOMPONENTS.JSX
//============================================================================================================================================
// 🧩 Follow-up 84: the Camera's Components page. The camera's components — its Camera Settings, and the camera effects every camera
// renders through (Lens Flare, Motion Blur, Post Process) — listed like the object's component stack. Picking one slides to that
// component's own inspector, live (it edits the same values the outliner row does, so the viewport follows); Back slides to the list.
// Closing the list leaves the open component's inspector on the page, with a strip to switch component.

import React, { useState } from "react";
import { ComponentPanel, ComponentSummary } from "./ObjectComponents.jsx";
import "./CameraComponents.css";

const Chevron = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Cross = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
const ListGlyph = (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M3 4h10M3 8h10M3 12h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

// The camera's own component rows first, then the effects under the Cameras folder (shared by every camera).
export function CameraComponentRows(Owner, Rows = []) {
  const Own = Rows.filter((Row) => Row.Parent === Owner.Id && Row.Panel === ComponentPanel);
  const Effects = Rows.filter((Row) => Row.Parent === "cameras" && Row.Panel !== "camera" && Row.Panel !== ComponentPanel && Row.Panel !== "group");
  return [...Own, ...Effects];
}
// Where a row keeps its values: a component on its owner, anything else on itself.
export const ComponentValueOwner = (Row) => (Row.Panel === ComponentPanel ? Row.Parent : Row.Id);

export function CameraComponentPage({ Owner, Scene, Kit, Inspect }) {
  const { Icon } = Kit;
  const Rows = CameraComponentRows(Owner, Scene?.Rows || []);
  const [Opened, Open] = useState(null);
  const [Closed, Close] = useState(false);
  const Current = Rows.find((Row) => Row.Id === Opened) || null;
  const Shown = Current || (Closed ? Rows[0] : null);
  const Summary = (Row) => {
    const Values = Scene?.Values?.[ComponentValueOwner(Row)] || {};
    if (Row.Panel === ComponentPanel) return ComponentSummary(Row, Owner, Values);
    return Values.Enabled === false ? "Switched off" : Row.Description || "";
  };
  const Live = (Row) => (
    <div className="cc-live" data-component-live={Row.Id} key={Row.Id}>
      {Inspect(Row)}
    </div>
  );

  // List closed: only the open component's inspector, live, with a strip to switch component or bring the list back.
  if (Closed && Shown)
    return (
      <div className="cc-page cc-closed">
        <nav className="cc-strip" aria-label="Camera components">
          <button type="button" className="cc-strip-list" onClick={() => Close(false)} title="Show the component list">
            {ListGlyph}
            Components
          </button>
          {Rows.map((Row) => (
            <button key={Row.Id} type="button" className={"cc-strip-item" + (Row.Id === Shown.Id ? " on" : "")} aria-pressed={Row.Id === Shown.Id} onClick={() => Open(Row.Id)} title={Row.Name}>
              {Icon && <Icon Name={Row.Icon} Size={16} />}
              <span>{Row.Name}</span>
            </button>
          ))}
        </nav>
        {Live(Shown)}
      </div>
    );

  return (
    <div className="cc-page">
      <div className={"cc-track" + (Current ? " at-entry" : "")}>
        <section className="cc-pane cc-list-pane" aria-hidden={!!Current} inert={Current ? "" : undefined}>
          <section className="pi-card oc-stack-card cc-stack-card" data-card="Camera components">
            <header className="pi-card-head">
              <h3>Components</h3>
              <span className="pi-card-aside">{Rows.length} on this camera</span>
              <button type="button" className="cc-close" onClick={() => { Close(true); if (!Opened && Rows[0]) Open(Rows[0].Id); }} title="Close the list · keep a component's inspector open, live" aria-label="Close the component list">
                {Cross}
              </button>
            </header>
            <ol className="oc-stack cc-stack" aria-label="Camera components">
              {Rows.map((Row) => {
                const Off = (Scene?.Values?.[ComponentValueOwner(Row)] || {}).Enabled === false;
                return (
                  <li key={Row.Id} className={"oc-entry cc-entry" + (Off ? " is-off" : "")} data-component={Row.Name}>
                    <button type="button" className="oc-open cc-open" onClick={() => Open(Row.Id)} title={`Open ${Row.Name}`}>
                      {Icon && <Icon Name={Row.Icon} Size={24} />}
                      <span>
                        <b>{Row.Name}</b>
                        <small>{Summary(Row)}</small>
                      </span>
                      <em className="cc-scope">{Row.Parent === "cameras" ? "All cameras" : "This camera"}</em>
                      {Chevron}
                    </button>
                  </li>
                );
              })}
            </ol>
            {Rows.length === 0 && <p className="oc-empty">No components on this camera.</p>}
          </section>
          <p className="pi-footnote oc-footnote">Open a component to edit it here, live. Effects under Cameras render through every camera.</p>
        </section>
        <section className="cc-pane cc-entry-pane" aria-hidden={!Current} inert={Current ? undefined : ""}>
          {Current && (
            <>
              <nav className="oc-crumbs cc-crumbs" aria-label="Component path">
                <button type="button" className="oc-back" onClick={() => Open(null)} title="Back to the components">
                  <span className="oc-back-arrow">{Chevron}</span>
                  Components
                </button>
                <span aria-hidden="true">/</span>
                <b>{Current.Name}</b>
                <span className="cc-live-dot" title="Edits apply live">Live</span>
                <button type="button" className="cc-close" onClick={() => Close(true)} title="Close the list · keep this inspector" aria-label="Close the component list">
                  {Cross}
                </button>
              </nav>
              {Live(Current)}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
