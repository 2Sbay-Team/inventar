import { test } from '@playwright/test';
const sizes = [
  { name: 'phone-414', w: 414, h: 896 },
  { name: 'tablet-1024', w: 1024, h: 768 },
];
for (const { name, w, h } of sizes) {
  test(`shot ${name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `/tmp/shot-${name}.png`, fullPage: false });
    await ctx.close();
  });
}
