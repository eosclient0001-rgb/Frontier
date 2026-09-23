// Keep an import/network failure from stranding the static loading screen.
let timer;
function failed(error) {
  console.error("Frontier startup:", error);
  document.querySelector("#loading").classList.remove("hidden");
  document.querySelector("#loading strong").textContent =
    "Frontier could not start";
  document.querySelector("#loading>span").textContent =
    error.message || String(error);
  document.querySelector("#render-recovery").classList.remove("hidden");
  document.querySelector("#retry-renderer").onclick = () => location.reload();
  document.querySelector("#error-details").onclick = () => {
    document.querySelector("#loading>span").textContent =
      `Frontier module loading failed: ${error.message}. This is separate from errors in the surrounding Arena page.`;
  };
}
async function start() {
  try {
    await Promise.race([
      import("./main.js"),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "App modules did not load within 30s. Open the preview in a separate tab and retry.",
              ),
            ),
          30000,
        );
      }),
    ]);
  } catch (error) {
    failed(error);
  } finally {
    clearTimeout(timer);
  }
}
start();
