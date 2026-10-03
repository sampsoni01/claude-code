#!/usr/bin/env bash
# Build the browser version into web/dist: the wasm module, its JS glue and
# the page. Needs the wasm32 target and a wasm-bindgen CLI matching the
# wasm-bindgen crate in Cargo.lock (pass its path in WASM_BINDGEN).
set -euo pipefail
cd "$(dirname "$0")/.."
WASM_BINDGEN="${WASM_BINDGEN:-wasm-bindgen}"
cargo build --release --target wasm32-unknown-unknown -p isoline --lib
rm -rf web/dist
mkdir -p web/dist
"$WASM_BINDGEN" --target web --no-typescript --out-dir web/dist --out-name isoline target/wasm32-unknown-unknown/release/isoline.wasm
if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -O2 --enable-bulk-memory --enable-nontrapping-float-to-int -o web/dist/isoline_bg.wasm web/dist/isoline_bg.wasm
fi
cp web/index.html web/dist/index.html
touch web/dist/.nojekyll
ls -la web/dist
