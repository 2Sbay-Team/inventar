import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6.2 ADR-032 — risk-aware update modal. Three render variants
// keyed off whats-new.json's risk_level:
//
//   safe       → reassurance lines, Install/Snooze/Skip
//   migration  → warning block + Export-backup hint, Install/Snooze/Skip
//   breaking   → strong warning + REQUIRED Export gate, Cancel/Install
//                (no Snooze/Skip — "force consideration")
//
// We drive the gate the same way 77_update_consent does — through the
// __inventarSeed.triggerUpdateWaiting() seam — and inject the desired
// whats-new payload via Playwright's page.route() interception.

const HIGHLIGHTS_3 = {
  en: ['One', 'Two', 'Three'],
  fr: ['Un', 'Deux', 'Trois'],
  ar: ['واحد', 'اثنان', 'ثلاثة'],
};

const MIGRATION_BLOCK = {
  summary: {
    en: 'Articles gain a tax_code column.',
    fr: 'Les articles gagnent une colonne tax_code.',
    ar: 'تكتسب المنتجات عمود tax_code.',
  },
  data_affected: ['articles', 'variants'],
  data_preservation: 'No rows are deleted.',
  rollback_supported: true,
};

const BACKUP_CHANGE = {
  from: 'v3',
  to: 'v4',
  backwards_compatible_import: true,
  forwards_compatible_export: false,
};

async function interceptWhatsNew(page: Page, payload: unknown): Promise<void> {
  await page.route('**/whats-new.json*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    }),
  );
}

async function bootAndTrigger(page: Page): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Risk Shop',
    storeType: 'fashion',
    fashionSubtypes: ['clothing_men'],
  });
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.__inventarSeed!.triggerUpdateWaiting());
  await expect(page.getByTestId('app-update-modal')).toBeVisible({ timeout: 10_000 });
}

// Swallow the actual download blob — the modal's Export button
// triggers a real <a download> click; we don't care about the bytes,
// just that the click handler resolved (setBackupExported(true) ran
// → the ✓ indicator appears). Without this, Playwright keeps the
// downloads in its test-results dir; cancelling cleans up.
function ignoreDownloads(page: Page): void {
  page.on('download', (download) => {
    void download.cancel();
  });
}

test.describe('v0.6.2 — update modal adapts to risk_level', () => {
  test('SAFE: reassurance lines visible, no warning/export blocks, full 3-button stack', async ({
    page,
  }) => {
    await interceptWhatsNew(page, {
      version: '0.6.2',
      released_at: '2026-06-01',
      risk_level: 'safe',
      highlights: HIGHLIGHTS_3,
    });
    await bootAndTrigger(page);

    await expect(page.getByTestId('app-update-modal')).toHaveAttribute('data-risk-level', 'safe');
    await expect(page.getByTestId('app-update-safe-reassurance')).toBeVisible();
    await expect(page.locator('[data-testid="app-update-migration-warning"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="app-update-breaking-warning"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="app-update-export-block"]')).toHaveCount(0);

    // Standard three-button stack.
    await expect(page.getByTestId('app-update-install')).toBeVisible();
    await expect(page.getByTestId('app-update-snooze')).toBeVisible();
    await expect(page.getByTestId('app-update-skip')).toBeVisible();
    await expect(page.locator('[data-testid="app-update-cancel-breaking"]')).toHaveCount(0);
  });

  test('MIGRATION: warning block carries summary + affected tables; Install/Snooze/Skip remain', async ({
    page,
  }) => {
    await interceptWhatsNew(page, {
      version: '0.6.2',
      released_at: '2026-06-01',
      risk_level: 'migration',
      migration: MIGRATION_BLOCK,
      highlights: HIGHLIGHTS_3,
    });
    await bootAndTrigger(page);

    await expect(page.getByTestId('app-update-modal')).toHaveAttribute(
      'data-risk-level',
      'migration',
    );
    const warning = page.getByTestId('app-update-migration-warning');
    await expect(warning).toBeVisible();
    await expect(page.getByTestId('app-update-migration-summary')).toContainText(
      'Articles gain a tax_code column.',
    );
    await expect(page.getByTestId('app-update-migration-affected')).toContainText(
      'articles, variants',
    );
    await expect(page.getByTestId('app-update-export-block')).toBeVisible();

    // 3-button stack still — migration doesn't gate Install.
    await expect(page.getByTestId('app-update-install')).toBeEnabled();
    await expect(page.getByTestId('app-update-snooze')).toBeVisible();
    await expect(page.getByTestId('app-update-skip')).toBeVisible();
    await expect(page.locator('[data-testid="app-update-cancel-breaking"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="app-update-breaking-warning"]')).toHaveCount(0);
  });

  test('BREAKING: Cancel is primary; Install starts disabled; no Snooze/Skip', async ({ page }) => {
    await interceptWhatsNew(page, {
      version: '0.6.2',
      released_at: '2026-06-01',
      risk_level: 'breaking',
      migration: MIGRATION_BLOCK,
      backup_format_change: BACKUP_CHANGE,
      highlights: HIGHLIGHTS_3,
    });
    await bootAndTrigger(page);

    await expect(page.getByTestId('app-update-modal')).toHaveAttribute(
      'data-risk-level',
      'breaking',
    );
    await expect(page.getByTestId('app-update-breaking-warning')).toBeVisible();
    await expect(page.getByTestId('app-update-cancel-breaking')).toBeVisible();
    // Install button exists but is disabled until export is tapped.
    await expect(page.getByTestId('app-update-install')).toBeDisabled();
    // No snooze, no skip (this is the N+6 check too).
    await expect(page.locator('[data-testid="app-update-snooze"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="app-update-skip"]')).toHaveCount(0);
  });

  test('backup_format_change renders the v3 → v4 transition + "old importable" note (migration)', async ({
    page,
  }) => {
    await interceptWhatsNew(page, {
      version: '0.6.2',
      released_at: '2026-06-01',
      risk_level: 'migration',
      migration: MIGRATION_BLOCK,
      backup_format_change: BACKUP_CHANGE,
      highlights: HIGHLIGHTS_3,
    });
    await bootAndTrigger(page);

    const block = page.getByTestId('app-update-backup-format-change');
    await expect(block).toBeVisible();
    await expect(block).toContainText('v3');
    await expect(block).toContainText('v4');
    // backwards_compatible_import=true → the reassurance line shows.
    await expect(block).toContainText('Old backups can still be imported');
  });

  test('Export backup button (migration): clicking surfaces ✓ Backup saved indicator', async ({
    page,
  }) => {
    ignoreDownloads(page);
    await interceptWhatsNew(page, {
      version: '0.6.2',
      released_at: '2026-06-01',
      risk_level: 'migration',
      migration: MIGRATION_BLOCK,
      highlights: HIGHLIGHTS_3,
    });
    await bootAndTrigger(page);

    // No indicator pre-click.
    await expect(page.locator('[data-testid="app-update-backup-saved"]')).toHaveCount(0);
    await page.getByTestId('app-update-export-backup').click();
    // The indicator surfaces once downloadBackupFile resolves.
    await expect(page.getByTestId('app-update-backup-saved')).toBeVisible({ timeout: 5_000 });
    // And Install is still enabled (migration doesn't gate it).
    await expect(page.getByTestId('app-update-install')).toBeEnabled();
  });

  test('Export backup button (breaking): clicking enables the Install button', async ({ page }) => {
    ignoreDownloads(page);
    await interceptWhatsNew(page, {
      version: '0.6.2',
      released_at: '2026-06-01',
      risk_level: 'breaking',
      migration: MIGRATION_BLOCK,
      backup_format_change: BACKUP_CHANGE,
      highlights: HIGHLIGHTS_3,
    });
    await bootAndTrigger(page);

    await expect(page.getByTestId('app-update-install')).toBeDisabled();
    await page.getByTestId('app-update-export-backup').click();
    await expect(page.getByTestId('app-update-backup-saved')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('app-update-install')).toBeEnabled();
  });

  test('Missing risk_level in whats-new.json defaults to safe layout', async ({ page }) => {
    // No risk_level field — the legacy payload shape that ships with
    // every v0.6 install. The validator normalizes to 'safe', so the
    // modal renders the reassurance branch.
    await interceptWhatsNew(page, {
      version: '0.5.4',
      released_at: '2026-05-11',
      highlights: HIGHLIGHTS_3,
    });
    await bootAndTrigger(page);

    await expect(page.getByTestId('app-update-modal')).toHaveAttribute('data-risk-level', 'safe');
    await expect(page.getByTestId('app-update-safe-reassurance')).toBeVisible();
    await expect(page.getByTestId('app-update-install')).toBeVisible();
    await expect(page.getByTestId('app-update-snooze')).toBeVisible();
    await expect(page.getByTestId('app-update-skip')).toBeVisible();
  });
});

// Re-declare the harness's seed shape so this spec compiles
// independently of 77_update_consent.spec.ts.
declare global {
  interface Window {
    __inventarSeed?: {
      seed: (input: unknown) => Promise<void>;
      sellOne: (articleName: string, size: string) => Promise<void>;
      reset: () => Promise<void>;
      deleteDb: () => Promise<void>;
      exportJson: () => Promise<string>;
      simulateScan: (value: string) => void;
      triggerUpdateWaiting: () => void;
      getUpdateActivateCalls: () => number;
    };
  }
}
