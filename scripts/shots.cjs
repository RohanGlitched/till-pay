// Full-page screenshots at desktop and phone widths, light and dark, for design review.
// Usage: node scripts/shots.cjs <baseUrl> <outDir> <path> [path...]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const [base, out, ...paths] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const sizes = (process.env.SIZES || "1440,390").split(",").map(Number);
  const schemes = (process.env.SCHEMES || "light").split(",");
  for (const scheme of schemes)
    for (const width of sizes) {
      const page = await browser.newPage({ viewport: { width, height: width > 800 ? 900 : 844 }, colorScheme: scheme, deviceScaleFactor: 1 });
      for (const p of paths) {
        await page.goto(base + p, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(Number(process.env.WAIT || 3500));
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        const name = `${(p.replace(/\W+/g, "_") || "_").replace(/^_+|_+$/g, "") || "home"}-${width}-${scheme}.png`;
        await page.screenshot({ path: `${out}/${name}`, fullPage: process.env.FULL !== "0" });
        console.log(name, "scrollWidth", sw, sw > width ? "OVERFLOW" : "ok");
      }
      await page.close();
    }
  await browser.close();
})();
