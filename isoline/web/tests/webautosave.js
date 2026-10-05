const { chromium } = require('playwright');
const ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-gpu-sandbox', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ARGS, headless: true });
  const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
  const t0 = Date.now(); const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  page.on('console', m => { const t = m.text(); if (/autosave|recover|crash|error|Opened/i.test(t)) console.log(stamp(), `[${m.type()}]`, t.slice(0, 200)); });
  page.on('pageerror', e => console.log(stamp(), '[pageerror]', e.message.slice(0, 200)));
  page.on('dialog', d => { console.log(stamp(), 'dialog', d.type()); d.accept(); });
  const ready = () => page.waitForFunction(() => document.getElementById('isoline').dataset.ready === '1', null, { timeout: 60000 });
  await page.goto(process.argv[2]); await ready(); await page.waitForTimeout(8000);
  await page.evaluate(() => window.isoline.run_command('autosave'));
  await page.waitForTimeout(4000);
  await page.reload(); await ready(); await page.waitForTimeout(10000);
  await page.screenshot({ path: 'ui_web_recovery.png' });
  // Click "Recover" in the prompt by finding it is not possible on a canvas; report status instead.
  await page.evaluate(() => window.isoline.run_command('status'));
  await page.waitForTimeout(500);
  await browser.close();
})().catch(e => { console.log('TEST ERROR', e.message); process.exit(1); });
