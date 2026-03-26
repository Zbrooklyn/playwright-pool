import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = __dirname;
const outputDir = path.resolve(__dirname, '..', 'prompt-results', 'hard-cases');

const pages = [
  { file: 'test-visual-subtle.html', prefix: 'subtle' },
  { file: 'test-visual-interaction.html', prefix: 'interaction' },
  { file: 'test-visual-responsive.html', prefix: 'responsive' },
];

const viewports = [
  { width: 1280, height: 800, suffix: 'desktop' },
  { width: 375, height: 812, suffix: 'mobile' },
];

async function main() {
  const browser = await chromium.launch({ headless: true });

  for (const pg of pages) {
    const filePath = path.join(fixturesDir, pg.file);
    const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;

    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.goto(fileUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      const outFile = path.join(outputDir, `${pg.prefix}-${vp.suffix}-${vp.width}x${vp.height}.png`);
      await page.screenshot({ path: outFile, fullPage: true });
      console.log(`Saved: ${outFile}`);

      await context.close();
    }
  }

  // Extra responsive breakpoints for the responsive page
  const responsiveBreakpoints = [
    { width: 1024, height: 768, suffix: '1024' },
    { width: 768, height: 1024, suffix: '768' },
    { width: 640, height: 960, suffix: '640' },
    { width: 520, height: 900, suffix: '520' },
    { width: 480, height: 854, suffix: '480' },
    { width: 320, height: 568, suffix: '320' },
  ];

  const responsiveFile = path.join(fixturesDir, 'test-visual-responsive.html');
  const responsiveUrl = `file://${responsiveFile.replace(/\\/g, '/')}`;

  for (const vp of responsiveBreakpoints) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(responsiveUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const outFile = path.join(outputDir, `responsive-breakpoint-${vp.suffix}.png`);
    await page.screenshot({ path: outFile, fullPage: true });
    console.log(`Saved: ${outFile}`);

    await context.close();
  }

  await browser.close();
  console.log('Done — all screenshots saved.');
}

main().catch((err) => { console.error(err); process.exit(1); });
