// Exercise the browser file flows: UI screenshot, save (download), drop an
// image, status, open the saved archive through the file picker, autosave +
// reload recovery.
const { chromium } = require('playwright');
const fs = require('fs');
const ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-gpu-sandbox', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ARGS, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  const log = (...a) => console.log(stamp(), ...a);
  page.on('console', m => { const t = m.text(); if (!/^\[INFO (wgpu|naga)/.test(t) && !/experimental/.test(t)) log(`[${m.type()}]`, t.slice(0, 200)); });
  page.on('pageerror', e => log('[pageerror]', e.message.slice(0, 200)));
  const cmd = c => page.evaluate(c => window.isoline.run_command(c), c);
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('isoline').dataset.ready === '1', null, { timeout: 60000 });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: 'ui_web.png' });
  log('--- screenshot of the UI taken');

  // Drop an image: it should become a project asset.
  const img = fs.readFileSync('import_test_src.png');
  await page.evaluate(b => window.isoline.drop_file('stone_circle.png', new Uint8Array(b)), Array.from(img));
  await page.waitForTimeout(3000);
  await cmd('status');
  await page.waitForTimeout(500);

  // Save: a download of the project archive.
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await cmd('save');
  const d = await dl;
  await d.saveAs('saved_project.isoline.zip');
  log('--- saved', d.suggestedFilename(), fs.statSync('saved_project.isoline.zip').size, 'bytes');
  await page.waitForTimeout(1000);

  // Open it again through the file picker.
  const chooser = page.waitForEvent('filechooser', { timeout: 30000 });
  await cmd('open');
  const fc = await chooser;
  await fc.setFiles('saved_project.isoline.zip');
  await page.waitForTimeout(8000);
  await cmd('status');
  await page.waitForTimeout(500);

  // Autosave now, reload, and expect a recovery prompt.
  await cmd('autosave');
  await page.waitForTimeout(4000);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('isoline').dataset.ready === '1', null, { timeout: 60000 });
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'ui_web_recovery.png' });
  log('--- screenshot after reload taken');
  await browser.close();
})().catch(e => { console.log('TEST ERROR', e.message); process.exit(1); });
