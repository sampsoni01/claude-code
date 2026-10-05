// Load the web build, wait for the map, ask the app to export a PNG, and save the download.
const { chromium } = require('playwright');
(async () => {
  const [url, out, secs] = [process.argv[2], process.argv[3], Number(process.argv[4] || 30)]; const scale = process.argv[5] || '1';
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-gpu-sandbox', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('isoline').dataset.ready === '1', null, { timeout: 60000 }).catch(() => logs.push('[test] ready flag never set'));
  logs.push(`[test] ready after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.waitForTimeout(secs * 1000);
  const dlPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.evaluate(s => window.isoline.run_command('export:' + s), scale);
  try {
    const dl = await dlPromise;
    await dl.saveAs(out);
    logs.push(`[test] downloaded ${dl.suggestedFilename()} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) { logs.push('[test] no download: ' + e.message.split('\n')[0]); }
  for (const l of logs.filter(l => !/^\[log\] \[INFO (wgpu|naga)/.test(l))) console.log(l.slice(0, 220));
  await browser.close();
})();
