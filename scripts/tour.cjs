// Screenshots every page for design review: home, your tabs (new visitor and a seeded freelancer),
// open, a live tab, and the 404. Usage: node scripts/tour.cjs <baseUrl> <outDir> [keysFile]
const fs = require("fs");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const [base, out, keysFile] = process.argv.slice(2);
const widths = (process.env.SIZES || "1440,390").split(",").map(Number);
const scheme = process.env.SCHEME || "light";

(async () => {
  const browser = await chromium.launch();
  const keys = keysFile ? JSON.parse(fs.readFileSync(keysFile, "utf8")) : null;
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: width > 800 ? 900 : 844 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const snap = async (path, name, wait = 6000) => {
      await page.goto(base + path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(wait);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      await page.screenshot({ path: `${out}/tour-${name}-${width}-${scheme}.png`, fullPage: true });
      console.log(name, width, sw > width ? `OVERFLOW ${sw}` : "ok");
    };
    // A new visitor with a fresh practice wallet.
    await page.goto(base + "/app");
    await page.getByRole("button", { name: /practice wallet/i }).click();
    await snap("/app", "app-new");
    await snap("/open", "open");
    await snap("/does-not-exist", "404", 2000);
    // A seeded freelancer's view (key stays inside this headless browser).
    if (keys) {
      await page.evaluate((k) => localStorage.setItem("till.practice.v1", k), keys.bot4.privateKey);
      await snap("/app", "app-freelancer", 9000);
      const href = await page.locator('a[href^="/tab/"]').first().getAttribute("href").catch(() => null);
      if (href) await snap(href, "tab", 14000);
    }
    if (errors.length) console.log("page errors:", errors.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
})();
