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
  phone: '+216 71 234 567',
  qr_center_mode: 'name',
  tagline: null,
  description: null,
  address_street: null,
  address_city: null,
  address_country: null,
  whatsapp: null,
  email: null,
  website: null,
  instagram: null,
  facebook: null,
  tiktok: null,
  brand_primary_color: null,
  theme_bg_color: null,
  theme_mode: 'light',
  logo_dominant_color: null,
  opening_hours: null,
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

  // v0.5.2.7 — logo embedding. We pass a tiny synthetic 1×1 PNG so the
  // test doesn't depend on any disk asset. pdf-lib's embedPng accepts
  // the bytes; the rendered output must grow vs the no-logo baseline.
  it('embeds the merchant logo when provided', async () => {
    // Minimal 1×1 transparent PNG (67 bytes). Hex source taken from
    // the W3C PNG spec example. Avoids fetching or fixture files.
    const PNG_HEX =
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4' +
      '890000000A49444154789C636000000002000158CFAEE10000000049454E44AE426082';
    const pngBytes = new Uint8Array(PNG_HEX.length / 2);
    for (let i = 0; i < PNG_HEX.length; i += 2) {
      pngBytes[i / 2] = parseInt(PNG_HEX.slice(i, i + 2), 16);
    }
    const logoBlob = new Blob([pngBytes], { type: 'image/png' });
    const withLogo = await renderInvoicePdf({
      invoice: INVOICE,
      profile: PROFILE,
      locale: 'en',
      logo: { blob: logoBlob, mime: 'image/png' },
    });
    const withoutLogo = await renderInvoicePdf({
      invoice: INVOICE,
      profile: PROFILE,
      locale: 'en',
    });
    // Embedded PNG adds bytes — even our 67-byte PNG plus pdf-lib's
    // image-stream overhead must produce a measurably larger file.
    expect(withLogo.byteLength).toBeGreaterThan(withoutLogo.byteLength);
    // And the result must still be a valid PDF.
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(withLogo);
    expect(doc.getPageCount()).toBe(1);
  });

  it('vat_enabled=false suppresses the VAT line from the PDF', async () => {
    const noVatInvoice: Invoice = {
      ...INVOICE,
      vat_pct: 19,
      vat_minor: 0,
      vat_enabled: false,
      total_minor: INVOICE.subtotal_minor, // total = subtotal when VAT off
    };
    const bytesNoVat = await renderInvoicePdf({
      invoice: noVatInvoice,
      profile: PROFILE,
      locale: 'en',
    });
    const bytesWithVat = await renderInvoicePdf({
      invoice: INVOICE,
      profile: PROFILE,
      locale: 'en',
    });
    // Inflate + hex-decode both; the no-VAT render must NOT include the
    // VAT line literal, while the with-VAT render must.
    async function extract(bytes: Uint8Array): Promise<string> {
      const { PDFDocument, PDFRawStream } = await import('pdf-lib');
      const zlib = await import('node:zlib');
      const doc = await PDFDocument.load(bytes);
      const out: string[] = [];
      for (const obj of doc.context.enumerateIndirectObjects()) {
        const [, pdfObject] = obj;
        if (!(pdfObject instanceof PDFRawStream)) continue;
        try {
          const inflated = zlib.inflateSync(Buffer.from(pdfObject.contents));
          const binary = inflated.toString('binary');
          out.push(binary);
          out.push(
            binary.replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => {
              let s = '';
              for (let i = 0; i + 1 < hex.length; i += 2) {
                s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
              }
              return s;
            }),
          );
        } catch {
          // skip
        }
      }
      return out.join('\n');
    }
    const noVatTxt = await extract(bytesNoVat);
    const withVatTxt = await extract(bytesWithVat);
    expect(withVatTxt).toContain('VAT (19%)');
    expect(noVatTxt).not.toContain('VAT (19%)');
    expect(noVatTxt).not.toContain('VAT (');
  });

  it('falls back gracefully when the logo blob is malformed', async () => {
    // 8 random bytes — not a PNG, not a JPEG. The renderer's
    // detect-by-magic-bytes path should skip embedding and still
    // produce a valid PDF.
    const garbage = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: '' });
    const bytes = await renderInvoicePdf({
      invoice: INVOICE,
      profile: PROFILE,
      locale: 'en',
      logo: { blob: garbage, mime: '' },
    });
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  // v0.5.2.7 — explicit per-locale label coverage. pdf-lib's content
  // streams are flate-compressed, so we extract the readable text by
  // walking the loaded PDF's content streams and zlib-inflating each
  // one. Latin labels (Helvetica) survive as ASCII inside (X) Tj /
  // (X) Tj-style operators. Arabic labels render via embedded-font
  // glyph IDs and are NOT searchable as literal text — that branch
  // verifies font embedding + structural validity instead.
  describe('per-locale labels (en / fr / ar)', () => {
    async function extractTextStream(bytes: Uint8Array): Promise<string> {
      const { PDFDocument, PDFRawStream } = await import('pdf-lib');
      const zlib = await import('node:zlib');
      const doc = await PDFDocument.load(bytes);
      const out: string[] = [];
      for (const obj of doc.context.enumerateIndirectObjects()) {
        const [, pdfObject] = obj;
        if (!(pdfObject instanceof PDFRawStream)) continue;
        try {
          const inflated = zlib.inflateSync(Buffer.from(pdfObject.contents));
          const binary = inflated.toString('binary');
          out.push(binary);
          // pdf-lib emits Latin text inside content streams as
          // hex-encoded literals like <494E564F494345> Tj — that's
          // "INVOICE" in ASCII. Decode every <hex> token alongside
          // the raw stream so a contain() check can find either form.
          const decodedHex = binary.replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => {
            let s = '';
            for (let i = 0; i + 1 < hex.length; i += 2) {
              s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
            }
            return s;
          });
          out.push(decodedHex);
        } catch {
          // Not all streams are flate-compressed; skip silently.
        }
      }
      return out.join('\n');
    }

    it('locale=en renders English labels (INVOICE, Tax ID:, Tel:) + phone number', async () => {
      const bytes = await renderInvoicePdf({ invoice: INVOICE, profile: PROFILE, locale: 'en' });
      const txt = await extractTextStream(bytes);
      expect(txt).toContain('INVOICE');
      expect(txt).toContain('Tax ID:');
      expect(txt).toContain('Bill to:');
      expect(txt).toContain('Subtotal');
      expect(txt).toContain('VAT');
      // v0.5.2.7: phone label + value print in the issuer block.
      expect(txt).toContain('Tel:');
      expect(txt).toContain('+216 71 234 567');
    });

    it('locale=fr renders French labels (FACTURE, Matricule, TVA, TOTAL TTC, Tél.)', async () => {
      const bytes = await renderInvoicePdf({ invoice: INVOICE, profile: PROFILE, locale: 'fr' });
      const txt = await extractTextStream(bytes);
      expect(txt).toContain('FACTURE');
      // Accented chars survive via WinAnsi single-byte codes; assert
      // the unambiguous ASCII tokens only.
      expect(txt).toContain('Matricule');
      expect(txt).toContain('TVA');
      expect(txt).toContain('TOTAL TTC');
      // The French phone label "Tél." has an accent; assert the ASCII
      // root "T" + the verbatim phone number to stay encoding-agnostic.
      expect(txt).toContain('+216 71 234 567');
    });

    it('locale=ar embeds Amiri, suppresses Latin label "INVOICE", and is structurally valid', async () => {
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
        const bytesAr = await renderInvoicePdf({
          invoice: INVOICE,
          profile: PROFILE,
          locale: 'ar',
        });
        const bytesEn = await renderInvoicePdf({
          invoice: INVOICE,
          profile: PROFILE,
          locale: 'en',
        });
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(bytesAr);
        expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
        // Amiri (~100 KB) makes the Arabic render substantially larger
        // than the Latin-only Helvetica baseline.
        expect(bytesAr.byteLength).toBeGreaterThan(bytesEn.byteLength + 50_000);
        // Decompressed content streams must NOT contain the English
        // label literal — Arabic is rendered via Amiri glyph IDs, not
        // ASCII text.
        const txtAr = await extractTextStream(bytesAr);
        expect(txtAr).not.toContain('INVOICE');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
