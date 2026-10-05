// Load the web build from a local server, wait for the map, screenshot it, and
// report console errors. Usage: node webtest.js <url> <out.png> [seconds]
const { chromium } = require('playwright');
(async () => {
  const [url, out, secs] = [process.argv[2], process.argv[3], Number(process.argv[4] || 25)];
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-gpu-sandbox', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], headless: true });
  const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForTimeout(secs * 1000);
  await page.screenshot({ path: out });
  const info = await page.evaluate(() => ({ canvasW: document.getElementById('isoline').width, canvasH: document.getElementById('isoline').height, loading: getComputedStyle(document.getElementById('loading')).display, crash: document.getElementById('isoline-crash') ? document.getElementById('isoline-crash').textContent : null }));
  console.log(JSON.stringify(info));
  console.log('--- console (' + logs.length + ' lines, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's) ---');
  for (const l of logs.filter(l => !/^\[log\] \[INFO wgpu|naga/.test(l)).slice(0, 80)) console.log(l);
  await browser.close();
})();
