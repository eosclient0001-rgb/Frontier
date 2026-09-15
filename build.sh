#!/usr/bin/env bash
# Bundle the app into ONE versioned file (edit TAG per release, then update
# the <script> ref + footer build tag in index.html + BUILD in js/main.js).
set -euo pipefail
cd "$(dirname "$0")"
TAG="${1:-b6}"
rm -f app-*.js app-*.js.map
npx -y esbuild@0.20.2 js/main.js --bundle --format=esm --platform=browser \
  --target=es2020 --alias:three=./vendor/three/build/three.module.js \
  --outfile="app-${TAG}.js" --minify --sourcemap
echo "built app-${TAG}.js"
