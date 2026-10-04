// End to end through the real UI with a practice wallet: faucet, profile, open a tab to a demo
// freelancer, watch it pay out, pause, close and get the rest back. Then the invite flow with a
// second browser as the freelancer.
// Usage: node scripts/e2e.cjs <baseUrl> [shotsDir]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const base = process.argv[2] || "http://localhost:3310";
const shots = process.argv[3];
const W = Number(process.env.WIDTH || 1280);

const step = (s) => console.log(`- ${s}`);
/** Waits for the success text, or reports the app's own error message if one appears first. */
async function expectOk(page, re, timeout = 60000) {
  const ok = page.getByText(re).first();
  const err = page.locator(".notice.error").first();
  await Promise.race([ok.waitFor({ timeout }), err.waitFor({ timeout }).then(async () => {
    throw new Error(`app said: ${await err.innerText()}`);
  })]);
}
async function shot(page, name) {
  if (shots) await page.screenshot({ path: `${shots}/e2e-${name}-${W}.png`, fullPage: true });
}

(async () => {
  const browser = await browser_();
  async function browser_() {
    return chromium.launch();
  }
  const client = await browser.newContext({ viewport: { width: W, height: 900 } });
  const page = await client.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));

  await page.goto(`${base}/app`);
  await page.getByRole("button", { name: /practice wallet/i }).click();
  step("practice wallet created");
  await page.getByRole("button", { name: "Get 10 test USDC" }).click();
  await page.getByText(/10 test USDC arrived/).waitFor({ timeout: 60000 });
  step("faucet: 10 test USDC arrived");

  await page.getByLabel("Name").fill("Mara Lindqvist");
  await page.getByLabel("City").fill("Stockholm");
  await page.getByLabel("Show amounts in").selectOption("EUR");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText(/Your notes print/).waitFor({ timeout: 60000 });
  step("profile saved on chain");
  await shot(page, "app");

  await page.goto(`${base}/open`);
  await page.getByRole("button", { name: /Tunde Bakare/ }).click();
  await page.getByLabel("Hourly rate").fill("60");
  await page.getByLabel("Budget").fill("2");
  await page.getByLabel(/What it/).fill("API review, first session");
  await shot(page, "open");
  await page.getByRole("button", { name: /Open tab with/ }).click();
  await expectOk(page, /is open\./);
  const title = await page.getByRole("heading", { level: 1 }).innerText();
  step(`opened: ${title}`);
  await page.getByRole("link", { name: "Go to the tab" }).click();

  await page.getByText("On the clock", { exact: false }).first().waitFor({ timeout: 60000 });
  step("demo freelancer clocked in by themselves");
  await page.getByText(/landed in/).first().waitFor({ timeout: 60000 });
  step(`payout while watching: ${await page.getByText(/landed in/).first().innerText()}`);
  await shot(page, "tab-live");

  await page.getByRole("button", { name: "Pause pay" }).click();
  await page.getByText("Pay paused by the client").first().waitFor({ timeout: 60000 });
  step("client paused pay");
  await page.getByRole("button", { name: /Close and get/ }).click();
  await page.getByText(/Tab closed\. Landed/).waitFor({ timeout: 60000 });
  step("closed and refunded");
  await page.getByText(/Tab closed, \$/).first().waitFor({ timeout: 30000 });
  step("pay stub shows the refund");
  await shot(page, "tab-closed");

  // Invite flow: the client opens a tab by link; a second browser joins as the freelancer.
  await page.goto(`${base}/open`);
  await page.getByText("Someone I'll invite by link").click();
  await page.getByLabel("Hourly rate").fill("25");
  await page.getByLabel("Budget").fill("1");
  await page.getByRole("button", { name: /Open tab with/ }).click();
  const linkBox = page.getByLabel("Invite link");
  await linkBox.waitFor({ timeout: 60000 });
  const link = await linkBox.inputValue();
  step(`invite link made: ${link.replace(/#k=.*/, "#k=…")}`);

  const free = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const fp = await free.newPage();
  fp.on("pageerror", (e) => console.log("FREELANCER PAGE ERROR", e.message));
  await fp.goto(link);
  await fp.getByRole("button", { name: /practice wallet/i }).click();
  await fp.getByLabel("Your name").fill("Ines Okafor");
  await fp.getByLabel("Your city").fill("Accra");
  await fp.getByRole("button", { name: "Join this tab" }).click();
  await fp.waitForURL(/\/tab\/\d+/, { timeout: 90000 });
  step("freelancer joined from the invite");
  await fp.getByRole("button", { name: "Clock in" }).click();
  await fp.getByText(/Clocked in\. Landed/).waitFor({ timeout: 60000 });
  step("freelancer clocked in");
  await fp.getByText(/landed in/).first().waitFor({ timeout: 60000 });
  step("freelancer sees payouts land");
  if (shots) await fp.screenshot({ path: `${shots}/e2e-freelancer-390.png`, fullPage: true });
  await fp.getByRole("button", { name: "Clock out" }).click();
  await fp.getByText(/Clocked out\. Landed/).waitFor({ timeout: 60000 });
  step("freelancer clocked out");

  await browser.close();
  console.log("E2E PASSED");
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
