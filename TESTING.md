# Inventar — Testing Strategy

The product is an offline-first PWA with no server. The testing strategy reflects that surface: Playwright for every screen and every button, a stress harness for the IndexedDB hot paths, and a dry-run mode for catching breakage before deploy.

The test suite is **part of the spec, not an afterthought**. Code is not done until tests pass. The Claude Code prompt instructs writing tests *before* implementation for the high-risk paths (offline writes, search correctness, photo persistence, locale switching).

---

## 1. Test pyramid

```
                ┌─────────────────────┐
                │   Manual smoke      │  ← code owner, before sending URL to user
                │   (10 minutes)      │
                └─────────────────────┘
            ┌───────────────────────────┐
            │  Playwright E2E           │  ← on every PR + nightly
            │  (every screen, button,   │
            │   offline mode, locale,   │
            │   backup/restore)         │
            └───────────────────────────┘
        ┌─────────────────────────────────┐
        │  Unit                           │  ← pure functions: search index,
        │  (utilities, formatters,        │     digit normalisation, money math,
        │   parsers, query parser)        │     period filters, quantity sum
        └─────────────────────────────────┘
```

Coverage targets:

- Unit ≥ 90 % for `utils/`, `db/`, `query/`, `i18n/`.
- Playwright covers every screen and every button at least once.

There is no integration tier because there is no server. The closest analogue is the Dexie tests, which run against fake-indexeddb in a Node environment.

---

## 2. Playwright E2E suite

### 2.1 Layout

```
web/e2e/
├── playwright.config.ts
├── fixtures/
│   ├── seed.ts            ← creates a fresh IndexedDB with N articles
│   └── photos/
│       └── sample.jpg
├── tests/
│   ├── 01_onboarding.spec.ts
│   ├── 02_search.spec.ts
│   ├── 03_article_detail.spec.ts
│   ├── 04_quick_adjust.spec.ts
│   ├── 05_add_article.spec.ts
│   ├── 06_dashboard.spec.ts
│   ├── 07_expense.spec.ts
│   ├── 08_settings.spec.ts
│   ├── 09_locale_switch.spec.ts
│   ├── 10_offline_writes.spec.ts
│   ├── 11_persistence.spec.ts
│   ├── 12_archive_and_delete.spec.ts
│   ├── 13_backup_export.spec.ts
│   ├── 14_backup_import.spec.ts
│   └── 15_search_normalisation.spec.ts
└── helpers/
    ├── offline.ts          ← context.setOffline wrappers
    ├── time.ts             ← clock manipulation
    ├── rtl.ts              ← assertions for RTL behaviour
    └── db.ts               ← inspect IndexedDB from page.evaluate
```

### 2.2 Test contract

Every test follows the same shape:

```ts
test('Quick adjust decrements stock and appends a movement', async ({ page }) => {
  // ARRANGE: seed IndexedDB with one article, size 42, qty 3
  await seedFresh(page, { articles: [{ sizes: { '42': 3 } }] });

  // ACT: navigate, search, tap size, sell, confirm
  await page.goto('/');
  await page.getByPlaceholder(/search/i).fill('white');
  await page.getByText('White running shoe').click();
  await page.getByRole('button', { name: '42' }).click();
  await page.getByRole('radio', { name: /sale/i }).check();
  await page.getByRole('button', { name: /confirm/i }).click();

  // ASSERT: UI shows 2; movements table contains the new row
  await expect(page.getByTestId('size-42-qty')).toHaveText('2');
  const movements = await page.evaluate(() =>
    indexedDB.databases().then(async () => {
      const db = await import('/src/db/db.js');
      return db.db.movements.toArray();
    })
  );
  expect(movements).toHaveLength(1);
  expect(movements[0]).toMatchObject({ delta: -1, type: 'sale' });
});
```

### 2.3 Coverage matrix — every button must be tested at least once

| Screen | Buttons / interactions |
|---|---|
| Onboarding | language picker (×3), shop name input, continue, backup-reminder dismiss |
| Search | search input (FR/AR/EN tokens), recent chip tap, result tap, bottom nav (×5), language toggle from header |
| Article detail | back, more menu (edit / take new photo / archive / delete forever), each size cell, sell, restock, copy SKU |
| Quick adjust | stepper −, stepper +, stepper number input, reason radios (×4), note field, cancel, confirm |
| Add article | photo CTA, retake, all 7 form fields, qty stepper ±, save, save and add another, validation errors per field |
| Dashboard | period selector (×4), top seller card tap (→ article detail), activity row tap, + Add expense FAB |
| Expense modal | category chips (×7), amount, note, date, recurring radios (×3), save |
| Settings | language picker, edit shop name, export data, import data (replace and merge paths), archive bin browse, restore archive, delete forever, reset everything |
| List | sort (×4), filter chips, archived toggle, article tap |
| Archive bin | restore article, delete forever |
| Locale switch | live without restart; verify all visible strings change; verify RTL direction; verify Eastern numerals |
| Backup banner | shows after 7 days simulated time; tap export; banner dismiss; reappears next week |

### 2.4 Offline tests (`10_offline_writes.spec.ts`)

The simplest test in this suite, because there is no server to switch off — but we want to verify the app makes zero network calls during steady-state use.

```ts
test('App makes zero network calls during steady-state use', async ({ page, context }) => {
  await seedFresh(page, { articles: 5 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // From now on, fail any network request
  let calls = 0;
  page.on('request', () => calls++);

  // Do a representative spread of actions
  await page.getByPlaceholder(/search/i).fill('white');
  await page.getByText(/article/i).first().click();
  await page.getByRole('button', { name: '42' }).click();
  await page.getByRole('button', { name: /confirm/i }).click();
  await page.goBack();

  // ASSERT: nothing went over the wire
  expect(calls).toBe(0);
});
```

### 2.5 Persistence test (`11_persistence.spec.ts`)

Verify data survives a simulated app restart.

```ts
test('Data survives page reload', async ({ page }) => {
  await page.goto('/');
  await onboard(page, { lang: 'fr', shopName: 'Persistence test' });
  await addArticle(page, { name: 'Persistence shoe', sizes: ['42'], qty: 1 });

  await page.reload();
  await expect(page.getByText('Persistence shoe')).toBeVisible();
  await expect(page.getByText('1 in size 42')).toBeVisible();
});

test('Persistence flag is requested on first launch', async ({ page }) => {
  let persistCalled = false;
  await page.exposeFunction('reportPersistCall', () => persistCalled = true);
  await page.addInitScript(() => {
    const orig = navigator.storage.persist.bind(navigator.storage);
    navigator.storage.persist = async () => {
      (window as any).reportPersistCall();
      return orig();
    };
  });
  await page.goto('/');
  await onboard(page, { lang: 'fr', shopName: 'Test' });
  expect(persistCalled).toBe(true);
});
```

### 2.6 Backup roundtrip (`13_backup_export.spec.ts`, `14_backup_import.spec.ts`)

```ts
test('Export then re-import round-trips losslessly', async ({ page }) => {
  await onboard(page, { lang: 'fr', shopName: 'RoundTrip' });
  await addArticle(page, { name: 'Round shoe', sizes: ['39', '40', '41'], qty: 2 });
  await sellOne(page, 'Round shoe', '40');

  const downloadPromise = page.waitForEvent('download');
  await page.goto('/settings');
  await page.getByRole('button', { name: /export/i }).click();
  const download = await downloadPromise;
  const path = await download.path();

  // Reset everything
  await page.getByRole('button', { name: /reset everything/i }).click();
  await page.getByPlaceholder(/type confirm/i).fill('CONFIRM');
  await page.getByRole('button', { name: /confirm/i }).click();

  // Import
  await page.goto('/settings');
  await page.setInputFiles('input[type=file]', path);
  await page.getByRole('button', { name: /replace/i }).click();

  // Verify everything came back
  await page.goto('/');
  await expect(page.getByText('Round shoe')).toBeVisible();
  await expect(page.getByText('1 in size 40')).toBeVisible();  // post-sale qty
});
```

### 2.7 Search normalisation (`15_search_normalisation.spec.ts`)

```ts
const cases = [
  { query: 'white 42',   matches: ['White running shoe'] },
  { query: 'blanc 42',   matches: ['White running shoe'] },  // FR
  { query: 'أبيض ٤٢',   matches: ['White running shoe'] },  // AR with Eastern digits
  { query: 'WHITE 42',   matches: ['White running shoe'] },  // case
  { query: 'white  42',  matches: ['White running shoe'] },  // double space
];

for (const { query, matches } of cases) {
  test(`Search "${query}" finds expected articles`, async ({ page }) => {
    await seedFresh(page, { articles: standardCatalogue });
    await page.goto('/');
    await page.getByPlaceholder(/search/i).fill(query);
    for (const name of matches) {
      await expect(page.getByText(name)).toBeVisible();
    }
  });
}
```

---

## 3. Stress tests

A separate suite, run nightly and before every release.

### 3.1 Bulk import

Goal: prove the app remains usable at the upper bound of expected data.

```
Setup:  Onboard, then bulk-create 1000 articles, 5 variants each = 5000 variants,
        20 movements per variant on average = 100,000 movements,
        500 expenses across the past year.
Assert: Search response < 500 ms (50th percentile), < 1.5 s (99th percentile).
        Article detail load < 200 ms.
        Dashboard "Year" period load < 1 s.
        IndexedDB total size < 200 MB.
```

### 3.2 Photo storage stress

Goal: verify compression handles real-world phone photos.

```
Setup:  Add 100 articles, each with a 4 MB raw JPEG photo from a real Android phone.
Assert: Each photo compresses to ≤ 200 KB.
        Total storage after 100 articles: < 25 MB.
        Add-article flow completes in < 1.5 s per article.
        No memory leaks (heap stable across 100 add cycles).
```

### 3.3 Concurrent writes

Goal: prove Dexie handles bursts without losing rows.

```
Setup:  Single tab, fire 200 movement appends in 5 seconds via test harness.
Assert: All 200 movements present in IndexedDB after the burst.
        Quantity sum is exactly the sum of deltas.
        No exceptions thrown.
        Search index updated for all affected variants.
```

### 3.4 Search index regeneration

Goal: verify `search_blob` rebuilds correctly under load.

```
Setup:  500 articles, then bulk-rename them all in a single transaction.
Assert: After regeneration, every article is findable by its new name.
        Old names no longer match.
        Operation completes in < 3 seconds.
```

---

## 4. Dry-run mode

A protocol for testing changes before deploy.

### 4.1 Local dry-run

```bash
# In /opt/inventar/web/, after a change
npm run build
npm run preview &  # serves dist/ on localhost:4173
PLAYWRIGHT_BASE_URL=http://localhost:4173 npm run test:e2e
```

This catches:
- Production-only bugs (Vite tree-shaking, env variables, asset paths).
- Service worker registration errors.
- Manifest mistakes.

### 4.2 Staging dry-run on the VPS

```bash
# On the VPS, in /opt/inventar/
git checkout -b staging
git merge main

# Build and start a separate compose on a different port
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build

# Add a separate Cloudflare Tunnel route: staging.inventar.hoodhood.ai → inventar_staging:80
# Run E2E against the staging URL
PLAYWRIGHT_BASE_URL=https://staging.inventar.hoodhood.ai npm run test:e2e
```

`docker-compose.staging.yml` overrides the service name and port mapping. The staging hostname is gated behind a Cloudflare Access policy so it isn't publicly reachable.

If E2E passes, merge staging back to main, deploy to production.

---

## 5. Manual smoke (the 10-minute pre-user check)

Before sending the URL to a real merchant, the code owner manually walks through:

1. Open `https://inventar.hoodhood.ai` in a private window on a phone.
2. Add to Home Screen.
3. Pick FR. Type "Smoke test shop". Continue.
4. Add an article: take a photo, name "Test shoe", sizes "39, 40, 41, 42", qty 2 each, prices.
5. Search for the article. Tap a size. Sell one. Confirm activity log updates.
6. Open Dashboard. Verify revenue line shows the sale.
7. Add an expense: transport 50 TND.
8. Switch to AR locale. Verify all numbers are Eastern Arabic, RTL layout works, search still works typing Arabic.
9. Switch to EN. Verify everything reads naturally.
10. Settings → Export Data. Verify JSON downloads. Open it in a text editor; spot-check it contains expected rows and a valid integrity hash.
11. Settings → Reset everything. Type CONFIRM. Verify all data is gone.
12. Settings → Import Data. Pick the file from step 10. Replace mode. Verify everything came back.
13. Disable wifi/cellular on the device. Add another article offline. Make a sale. Verify it works.
14. Reconnect. Verify nothing visually changed (no spinners, no "syncing" indicators — there is no sync).

If any step fails, the URL is not sent to the merchant.

---

## 6. CI

Every PR runs:

- Unit tests (vitest with fake-indexeddb)
- Playwright smoke set (tests 01, 02, 05, 10, 11, 13)

Nightly runs:

- Full Playwright suite
- Stress tests (3.1 to 3.4)
- Locale snapshot tests (visual diffs against committed PNGs of the home screen for FR/AR/EN)

CI runner: GitHub Actions for cleanliness, or a self-hosted runner on the VPS for cost. Decide at integration time.
