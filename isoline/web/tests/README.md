# Browser tests

Playwright scripts that drive the web build in headless Chromium. They need
`web/dist` served over http (for example `http-server web/dist -p 8766`) and
Playwright with a Chromium that offers WebGPU. Without a graphics card,
Chromium keeps a WebGPU device alive only with the flag set the scripts use
(SwiftShader for both Vulkan and ANGLE, GPU sandbox off).

- `webtest.js <url> <out.png> [seconds]` loads the page, waits, screenshots,
  and prints console output.
- `webexport.js <url> <out.png> [seconds] [scale]` asks the app to export the
  map and saves the downloaded PNG. This is the reliable way to see what the
  app renders: page screenshots of a WebGPU canvas are blank in some headless
  setups.
- `webflows.js <url>` exercises image drop, save (download), open through the
  file picker, autosave and reload.
- `webautosave.js <url>` checks that an autosave is offered for recovery after
  a reload.

The app accepts page commands for these tests through `window.isoline.run_command`:
`export[:scale]`, `fit`, `save`, `open`, `autosave`, `status`.
