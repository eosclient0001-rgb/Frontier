# Verification tools

`compare.html` — overlays the model's silhouette on the reference skeletal drawing
(Hartman / Franoys, FMNH PR 2081 "Sue") and scores the match numerically.

```
cd trex/tools
npm i puppeteer-core@23 @sparticuz/chromium@131
node -e "const z=require('zlib'),f=require('fs');f.writeFileSync('/tmp/al2023.tar',z.brotliDecompressSync(f.readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')))" 
mkdir -p /tmp/libs && tar -xf /tmp/al2023.tar -C /tmp/libs
LD_LIBRARY_PATH=/tmp/libs/lib:/tmp node -e "1"   # libs needed by headless chromium
```
Then serve the repo root and open `trex/tools/compare.html`. `overlay.png` is the
rendered comparison (grey = reference, orange = this model).

`selftest.mjs` — headless checks that run the rig through idle / walk / run and
measure: ground penetration, IK accuracy, planted-foot slip, transition smoothness,
and whether it settles back into a square stance.

Current results: top-line silhouette error 15 cm mean (43 cm worst) against the
reference; zero ground penetration; zero foot slip beyond 0.03 m/s.
