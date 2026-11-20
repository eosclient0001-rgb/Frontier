# Editor preview verification

Both editor trees were imported verbatim from `SultanAladin/Frontier` at
`63db1201d0cea199c7276c2126e62812b04821b9` into baseline `e2b5be5`.
The source tree hashes match: Project Zero `f188f1dd`, Frontier `06a49ff8`.
No pane changes or other prototype imports were included.

| Browser preview | Port | Verified interaction | Capture |
|---|---:|---|---|
| Project Zero Editor | 8092 | Search and select Moons, close the Inspector tab, reopen it from the tab menu. | [Project Zero](ProjectZero.png) |
| Frontier Editor | 5173 | Build with Vite, search and select Moon, open Construct and dismiss it with Escape. | [Frontier](Frontier.png) |

Both main pages returned HTTP 200 and had no uncaught page errors in Chromium
131.0.6778.0 at 1440 × 900, with Debian 12 x64, Node 22.22.3, npm 10.9.8,
and Vite 6.4.3. External font requests to Fontshare and Google Fonts failed in
this environment; the captures show the resulting font fallbacks. Native
Construct creation is not connected, and Project Zero's neighboring-prototype
links and standalone-page regeneration were not tested. These are browser
previews, not validation of a native editor build.

## Reproduce from the repository root

Build Frontier Editor, then run each server command in its own terminal:

```sh
npm --prefix Experimental/FrontierEditor ci
npm --prefix Experimental/FrontierEditor run build
python3 -m http.server 8092 --bind 0.0.0.0 --directory Experimental/ProjectZeroEditor
python3 -m http.server 5173 --bind 0.0.0.0 --directory Experimental/FrontierEditor/dist
```

Run the capture on Linux x64 with Node.js 22 and the pinned browser tooling:

```sh
BrowserDir=_ClaudeScratch/tmp/EditorBrowser
npm install --prefix "$BrowserDir" --no-audit --no-fund \
  @sparticuz/chromium@131.0.1 playwright-core@1.49.1
# Extract the browser package's NSS libraries if not installed on the host.
mkdir -p "$BrowserDir/Libraries"
node -e 'require("node:fs").createReadStream(process.argv[1]).pipe(require("node:zlib").createBrotliDecompress()).pipe(process.stdout)' \
  "$BrowserDir/node_modules/@sparticuz/chromium/bin/al2023.tar.br" \
  | tar -xf - -C "$BrowserDir/Libraries"
LD_LIBRARY_PATH="$PWD/$BrowserDir/Libraries/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  node Exhibits/EditorPreviewValidation/Capture.mjs
```
