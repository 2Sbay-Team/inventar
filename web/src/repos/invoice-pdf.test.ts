import { describe, expect, it } from 'vitest';
import { invoicePdfFilename, renderInvoicePdf } from './invoice-pdf';
import { type Invoice, type ShopProfile } from '../types';

const NOW = '2026-05-10T10:00:00.000Z';

const PROFILE: ShopProfile = {
  id: 'singleton',
  name: 'Naili Shoes',
  locale: 'fr',
  logo_photo_id: null,
  currency: 'TND',
  store_type: 'fashion',
  shop_subtypes: [],
  fashion_subtypes: ['shoes'],
  location_floor_label: 'Boutique',
  location_back_label: 'Réserve',
  expiry_warning_days: 7,
  legal_name: 'NAILI SARL',
  legal_address: '14 rue de Tunis\n1000 Tunis',
  fiscal_id: '1234567/A/B/000',
  default_vat_pct: 19,
  created_at: NOW,
  updated_at: NOW,
  last_backup_at: null,
};

const INVOICE: Invoice = {
  id: 'inv-1',
  number: 'INV-2026-0042',
  issued_at: NOW,
  customer_name: 'ACME Co',
  customer_address: '1 rue X\n2000 Sousse',
  customer_fiscal_id: '9876543/Z/Z/000',
  lines: [
    { description: 'Item A', reference: 'SP-0001', qty: 2, unit_price_minor: 12_500 },
    { description: 'Item B', reference: null, qty: 1, unit_price_minor: 7_500 },
  ],
  currency: 'TND',
  subtotal_minor: 32_500,
  vat_pct: 19,
  vat_minor: 6_175,
  total_minor: 38_675,
  notes: null,
  transaction_id: null,
  created_at: NOW,
  deleted_at: null,
};

describe('invoice PDF (ADR-024)', () => {
  it('produces a non-empty Uint8Array starting with the PDF header', async () => {
    const bytes = await renderInvoicePdf({ invoice: INVOICE, profile: PROFILE });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(500);
    // Every PDF file starts with %PDF-
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('round-trips through pdf-lib (re-load the bytes and read the page count)', async () => {
    const bytes = await renderInvoicePdf({ invoice: INVOICE, profile: PROFILE });
    // Re-parse via pdf-lib to confirm the bytes are a structurally
    // valid PDF (not just %PDF- prefix + garbage). One page is the
    // current layout; multi-page only happens on overflow.
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('Arabic customer data triggers Amiri embedding (font present, valid PDF)', async () => {
    // Stub fetch so the test runs in jsdom without hitting the network.
    // The Amiri woff2 ships in node_modules; we read it from disk.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const fontPath = path.resolve(
      process.cwd(),
      'node_modules/@fontsource/amiri/files/amiri-arabic-400-normal.woff2',
    );
    const fontBytes = fs.readFileSync(fontPath);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(fontBytes), { status: 200 })) as typeof fetch;

    try {
      const arInvoice: Invoice = { ...INVOICE, customer_name: 'زبون عابر' };
      const bytes = await renderInvoicePdf({
        invoice: arInvoice,
        profile: PROFILE,
        locale: 'ar',
      });
      expect(bytes.byteLength).toBeGreaterThan(500);
      expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Latin-only invoice with locale=en does NOT load Amiri (no fetch)', async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error('should not fetch font for Latin-only invoice');
    }) as typeof fetch;
    try {
      const bytes = await renderInvoicePdf({ invoice: INVOICE, profile: PROFILE, locale: 'en' });
      expect(bytes.byteLength).toBeGreaterThan(500);
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles a missing profile (uses an empty header)', async () => {
    const bytes = await renderInvoicePdf({ invoice: INVOICE, profile: null });
    expect(bytes.byteLength).toBeGreaterThan(400);
  });

  it('filename is derived from the invoice number', () => {
    expect(invoicePdfFilename(INVOICE)).toBe('INV-2026-0042.pdf');
  });
});
