// Exchange supported gas parameters with the parent editor, without echoing its initial scene.
export function InstallEditorHandoff(Panel, Host = window) {
  if (!Host.parent || Host.parent === Host) return;
  let Receiving = false;
  const Send = () => {
    if (!Receiving) Host.parent.postMessage({
      Frontier: "gas-scene-changed",
      Settings: { ...Panel.Parameters },
    }, Host.location.origin);
  };
  Host.addEventListener("message", (Event) => {
    if (Event.source !== Host.parent || Event.origin !== Host.location.origin ||
        Event.data?.Frontier !== "gas-scene" || !Event.data.Settings ||
        typeof Event.data.Settings !== "object") return;
    Receiving = true;
    try {
      for (const [Key, Value] of Object.entries(Event.data.Settings)) {
        if (Object.hasOwn(Panel.Parameters, Key)) Panel.ApplyParameter(Key, Value);
      }
      if (typeof Event.data.Name === "string") Panel.SetHandoffName(Event.data.Name);
    } finally {
      Receiving = false;
    }
  });
  Panel.NotifyHandoff = Send;
}
