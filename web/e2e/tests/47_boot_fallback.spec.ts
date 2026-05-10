import { expect, test } from '@playwright/test';

// v0.5.1: bulletproof boot fallback. The inline #boot-fallback in
// index.html shows a spinner immediately and, after a 10 s watchdog,
// swaps in a "clear cache & reload" UI for the merchant. main.tsx
// removes the fallback once React mounts via __inventarBootCleanup.
//
// We verify two things here:
//   1. The fallback is in the static HTML response (so it works even
//      when JS chunks fail to load — we can't actually break a chunk
//      from a test but proving the markup exists in the served HTML
//      is the meaningful check).
//   2. After a normal page load, main.tsx has removed it. If this
//      assertion regresses we'd have a permanent loading spinner
//      stacked on top of the App.

test.describe('Boot fallback', () => {
  test('inline fallback markup is served in the HTML response', async ({ request }) => {
    const res = await request.get('/');
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    // The fallback DOM, the watchdog script, and the clear-cache
    // wiring all live inline in index.html. Catching any of these
    // missing means the entry-point template was rebuilt without
    // the fallback (which would silently re-introduce the
    // blank-screen failure mode).
    expect(html).toContain('id="boot-fallback"');
    expect(html).toContain('data-testid="boot-clear-cache"');
    expect(html).toContain('__inventarBootCleanup');
  });

  test('fallback is removed once React mounts', async ({ page }) => {
    await page.goto('/');
    // Onboarding step-language is the very first thing the App
    // renders for an empty profile — wait for it before asserting
    // the fallback is gone, so we know we're testing the post-mount
    // state, not a race where React hasn't run yet.
    await expect(page.getByTestId('step-language')).toBeVisible();
    await expect(page.getByTestId('boot-fallback')).toHaveCount(0);
  });
});
