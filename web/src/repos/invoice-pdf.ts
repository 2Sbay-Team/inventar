import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as ArabicReshaperLib from 'arabic-reshaper';
import amiriUrl from '@fontsource/amiri/files/amiri-arabic-400-normal.woff2?url';
import { type Invoice, type Locale, type ShopProfile } from '../types';

// v0.5.2.5+ ADR-024 — render an Invoice into a real PDF byte stream so
// the merchant can attach it to WhatsApp / email / Drive via the OS
// share sheet. Browser-print stays as a fallback.
//
// Latin text uses pdf-lib's built-in Helvetica (no embedded font bytes).
// Arabic text uses the Amiri Naskh font (~107KB woff2, lazy-loaded only
// when the invoice contains any Arabic codepoint OR locale='ar'); read
// via fontkit so pdf-lib accepts the woff2 binary. Strings are passed
// through arabic-reshaper to produce the connected-letter presentation
// forms (initial / medial / final / isolated) that simple PDF renderers
// can't compute on their own, then reversed so the visual order
// matches RTL when drawn left-to-right by pdf-lib.
//
// Bidirectional text (a single string containing both Latin and Arabic
// runs) is handled by detecting which script dominates the field and
// routing the WHOLE field to that font + alignment. Mixed inline
// content within one field (e.g. "Order #123 طلب") will render but is
// not bidi-correct — full BiDi layout is a follow-up if real merchants
// ask for it.

interface RenderOptions {
  invoice: Invoice;
  profile: ShopProfile | null;
  // App locale at issue time. Drives label translation (EN/FR/AR) and
  // header alignment. Optional for back-compat — defaults to 'en'.
  locale?: Locale;
  // v0.5.2.7 — merchant logo blob, looked up by the caller from
  // profile.logo_photo_id. Null/omitted = no logo (current behaviour).
  // Passing the blob directly (rather than reading it inside the
  // renderer) keeps invoice-pdf.ts free of a Dexie dependency, which
  // matters for the unit tests that exercise it without a DB.
  logo?: { blob: Blob; mime: string } | null;
}

const PAGE_W = 595; // A4 width in points
const PAGE_H = 842; // A4 height in points
const MARGIN = 48;
const LINE_GAP = 14;

// Arabic Unicode block ranges. Defined as numeric ranges (not a regex
// literal) so the source file stays free of literal Arabic characters
// that would trip eslint's no-irregular-whitespace rule (U+FEFF lives
// at the end of the Presentation Forms-B range).
const ARABIC_RANGES: ReadonlyArray<[number, number]> = [
  [0x0600, 0x06ff], // Arabic
  [0x0750, 0x077f], // Arabic Supplement
  [0xfb50, 0xfdff], // Arabic Presentation Forms-A
  [0xfe70, 0xfefe], // Arabic Presentation Forms-B (excludes BOM at 0xFEFF)
];

function containsArabic(text: string | null | undefined): boolean {
  if (text == null) return false;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    for (const [lo, hi] of ARABIC_RANGES) {
      if (code >= lo && code <= hi) return true;
    }
  }
  return false;
}

interface Reshaper {
  convertArabic: (s: string) => string;
}

function shapeArabic(text: string): string {
  // arabic-reshaper converts logical-order Unicode to presentation
  // forms. We then reverse so a naive left-to-right renderer (pdf-lib)
  // produces visually-correct RTL output.
  const r = ArabicReshaperLib as unknown as Reshaper | { default: Reshaper };
  const lib = 'convertArabic' in r ? r : (r as { default: Reshaper }).default;
  const presentation = lib.convertArabic(text);
  return [...presentation].reverse().join('');
}

// Helvetica covers Latin-1 only. We strip anything outside that range
// when we know the field is Latin-routed, so emoji / CJK fall back to
// '?' rather than crashing pdf-lib's WinAnsi encoder. Arabic-routed
// fields use Amiri and don't need stripping.
function safeLatin(input: string | null | undefined): string {
  if (input == null) return '';
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    out += code <= 0xff ? ch : '?';
  }
  return out;
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(minor / 1000);
}

interface PdfLabels {
  invoice: string;
  number: string; // displayed as "No. {number}" — the prefix label only
  date: string;
  bill_to: string;
  walk_in: string;
  tax_id: string;
  // v0.5.2.7 — phone prefix used in the issuer block (e.g. "Tel: ...").
  // Kept short because phone numbers can be long with country codes.
  tel: string;
  description: string;
  qty: string;
  unit: string;
  total_col: string;
  subtotal: string;
  vat: string;
  total: string;
  notes: string;
}

const LABELS: Record<Locale, PdfLabels> = {
  en: {
    invoice: 'INVOICE',
    number: 'No.',
    date: 'Date:',
    bill_to: 'Bill to:',
    walk_in: 'Walk-in customer',
    tax_id: 'Tax ID:',
    tel: 'Tel:',
    description: 'Description',
    qty: 'Qty',
    unit: 'Unit',
    total_col: 'Total',
    subtotal: 'Subtotal',
    vat: 'VAT',
    total: 'TOTAL',
    notes: 'Notes:',
  },
  fr: {
    invoice: 'FACTURE',
    number: 'N°',
    date: 'Date :',
    bill_to: 'Client :',
    walk_in: 'Client de passage',
    tax_id: 'Matricule fiscal :',
    tel: 'Tél. :',
    description: 'Désignation',
    qty: 'Qté',
    unit: 'P.U.',
    total_col: 'Total',
    subtotal: 'Sous-total',
    vat: 'TVA',
    total: 'TOTAL TTC',
    notes: 'Notes :',
  },
  ar: {
    invoice: 'فاتورة',
    number: 'رقم',
    date: 'التاريخ:',
    bill_to: 'الزبون:',
    walk_in: 'زبون عابر',
    tax_id: 'المعرّف الجبائي:',
    tel: 'الهاتف:',
    description: 'الوصف',
    qty: 'الكمية',
    unit: 'سعر الوحدة',
    total_col: 'المجموع',
    subtotal: 'المجموع الفرعي',
    vat: 'رسم القيمة المضافة',
    total: 'المجموع الكلي',
    notes: 'ملاحظات:',
  },
};

let amiriBytesCache: ArrayBuffer | null = null;

// Loads the Amiri Arabic font once per session. Called only when the
// invoice or its profile contains Arabic content or locale='ar'.
async function loadAmiriBytes(): Promise<ArrayBuffer> {
  if (amiriBytesCache) return amiriBytesCache;
  const res = await fetch(amiriUrl);
  if (!res.ok) throw new Error(`failed to fetch Amiri font: ${res.status}`);
  amiriBytesCache = await res.arrayBuffer();
  return amiriBytesCache;
}

interface DrawCtx {
  page: PDFPage;
  font: PDFFont; // Helvetica (Latin)
  bold: PDFFont; // Helvetica-Bold (Latin)
  arabic: PDFFont | null; // Amiri (Arabic), null if not loaded
  y: number;
  doc: PDFDocument;
  currency: string;
}

interface DrawOpts {
  x: number;
  bold?: boolean;
  size?: number;
  // When true, x is treated as the RIGHT edge and the text is drawn
  // ending at that x. Used for Arabic / right-aligned columns.
  rightAlign?: boolean;
}

// Splits a mixed-script string into consecutive runs, each tagged
// with which font it should render under. This is what fixes the
// "boxes for Latin chars in fields with Arabic" bug — Amiri's Arabic
// subset has no Latin glyphs, so a string like "Tax ID: 1234567" must
// be drawn with Helvetica for the Latin chars and Amiri for the Arabic
// chars. Whitespace is attached to whichever run precedes it so we
// don't introduce micro-breaks at every space.
interface ScriptRun {
  text: string;
  isArabic: boolean;
}

function splitByScript(text: string): ScriptRun[] {
  const runs: ScriptRun[] = [];
  let current = '';
  let currentIsArabic = false;
  for (const ch of text) {
    const charIsArabic = containsArabic(ch);
    const isWhitespace = ch === ' ' || ch === '\t';
    if (current === '' || isWhitespace || charIsArabic === currentIsArabic) {
      current += ch;
      if (current === ch) currentIsArabic = charIsArabic;
    } else {
      runs.push({ text: current, isArabic: currentIsArabic });
      current = ch;
      currentIsArabic = charIsArabic;
    }
  }
  if (current !== '') runs.push({ text: current, isArabic: currentIsArabic });
  return runs;
}

function drawText(ctx: DrawCtx, text: string, opts: DrawOpts): void {
  const size = opts.size ?? 10;
  const helv = opts.bold ? ctx.bold : ctx.font;
  // No Arabic font available OR no Arabic content → fast path: single
  // Helvetica draw with the existing Latin-stripping safeguard.
  if (ctx.arabic == null || !containsArabic(text)) {
    const rendered = safeLatin(text);
    const width = helv.widthOfTextAtSize(rendered, size);
    const x = opts.rightAlign ? opts.x - width : opts.x;
    ctx.page.drawText(rendered, { x, y: ctx.y, size, font: helv, color: rgb(0.12, 0.12, 0.13) });
    return;
  }

  // Mixed-or-Arabic content: split into per-script runs so Latin chars
  // don't get routed through Amiri (which lacks Latin glyphs).
  const runs = splitByScript(text);
  // Compute each run's rendered form + width, then total width, so we
  // can right-align the whole string and lay runs out left-to-right.
  // Note: we don't reorder per BiDi here — runs draw in source order.
  // This is correct for RTL fields where the Arabic content dominates
  // (e.g. "Tax ID: 1234567" rendered in an Arabic-locale context puts
  // the Latin number to the right of the Arabic label, which is the
  // visually-correct layout for that string).
  const prepared = runs.map((r) => {
    const font = r.isArabic ? ctx.arabic! : helv;
    const rendered = r.isArabic ? shapeArabic(r.text) : safeLatin(r.text);
    const width = font.widthOfTextAtSize(rendered, size);
    return { font, rendered, width };
  });
  const totalWidth = prepared.reduce((s, p) => s + p.width, 0);
  // Respect the caller's anchor: opts.x is the right edge when
  // opts.rightAlign is set (column totals, right-column header,
  // dedicated right-aligned Arabic blocks); otherwise it's the left
  // edge and the text grows rightward. Without this distinction
  // left-anchored Arabic fields (legal_name at MARGIN, address lines,
  // notes) get clipped off the left page edge.
  let cursorX = opts.rightAlign ? opts.x - totalWidth : opts.x;
  for (const p of prepared) {
    ctx.page.drawText(p.rendered, {
      x: cursorX,
      y: ctx.y,
      size,
      font: p.font,
      color: rgb(0.12, 0.12, 0.13),
    });
    cursorX += p.width;
  }
}

function newLine(ctx: DrawCtx, by: number = LINE_GAP): void {
  ctx.y -= by;
  if (ctx.y < MARGIN + 60) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.y = PAGE_H - MARGIN;
  }
}

function drawHRule(ctx: DrawCtx): void {
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.86),
  });
}

// Decides whether we need to embed the Arabic font for this invoice:
// any Arabic codepoint in the data, OR an Arabic-locale render request.
function needsArabicFont(invoice: Invoice, profile: ShopProfile | null, locale: Locale): boolean {
  if (locale === 'ar') return true;
  if (containsArabic(profile?.legal_name) || containsArabic(profile?.name)) return true;
  if (containsArabic(profile?.legal_address) || containsArabic(profile?.fiscal_id)) return true;
  if (containsArabic(profile?.phone)) return true;
  if (containsArabic(invoice.customer_name) || containsArabic(invoice.customer_address)) {
    return true;
  }
  if (containsArabic(invoice.customer_fiscal_id) || containsArabic(invoice.notes)) return true;
  return invoice.lines.some((l) => containsArabic(l.description) || containsArabic(l.reference));
}

export async function renderInvoicePdf({
  invoice,
  profile,
  locale = 'en',
  logo = null,
}: RenderOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let arabic: PDFFont | null = null;
  if (needsArabicFont(invoice, profile, locale)) {
    doc.registerFontkit(fontkit);
    const bytes = await loadAmiriBytes();
    arabic = await doc.embedFont(bytes);
  }
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const labels = LABELS[locale];

  // ─── Logo (v0.5.2.7): embed at top-left if the merchant set one.
  // Detect mime via the blob's `type` first; fall back to inspecting
  // the magic bytes (JPEG: FF D8 FF, PNG: 89 50 4E 47) so a row with
  // an empty `type` doesn't silently get skipped. Failures are
  // swallowed — an unparseable image must not break invoice generation.
  let embeddedLogo: PDFImage | null = null;
  if (logo) {
    try {
      const arrBuf = await logo.blob.arrayBuffer();
      const head = new Uint8Array(arrBuf.slice(0, 8));
      const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      const declared = logo.mime || logo.blob.type || '';
      if (declared.includes('png') || (declared === '' && isPng)) {
        embeddedLogo = await doc.embedPng(arrBuf);
      } else if (
        declared.includes('jpeg') ||
        declared.includes('jpg') ||
        (declared === '' && isJpg)
      ) {
        embeddedLogo = await doc.embedJpg(arrBuf);
      }
    } catch {
      embeddedLogo = null;
    }
  }
  // Reserve a 48pt-high logo slot at the top of the page. When no logo
  // is present we collapse it to zero so existing layouts stay identical.
  const LOGO_BOX = 48;
  const logoSpace = embeddedLogo ? LOGO_BOX + 8 : 0;

  const ctx: DrawCtx = {
    page,
    font,
    bold,
    arabic,
    y: PAGE_H - MARGIN - logoSpace,
    doc,
    currency: invoice.currency,
  };

  if (embeddedLogo) {
    // Preserve aspect ratio inside an LOGO_BOX × LOGO_BOX bounding box,
    // anchored at top-left of the header.
    const scale = Math.min(LOGO_BOX / embeddedLogo.width, LOGO_BOX / embeddedLogo.height);
    const w = embeddedLogo.width * scale;
    const h = embeddedLogo.height * scale;
    page.drawImage(embeddedLogo, {
      x: MARGIN,
      y: PAGE_H - MARGIN - h,
      width: w,
      height: h,
    });
  }

  // ─── Header: shop info + INVOICE label + number ───────────────────
  drawText(ctx, profile?.legal_name ?? profile?.name ?? '', {
    x: MARGIN,
    bold: true,
    size: 14,
  });
  drawText(ctx, labels.invoice, { x: PAGE_W - MARGIN, rightAlign: true, bold: true, size: 16 });
  newLine(ctx, 20);

  if (profile?.legal_address) {
    for (const line of profile.legal_address.split('\n')) {
      drawText(ctx, line, { x: MARGIN, size: 9 });
      newLine(ctx, 11);
    }
  }
  if (profile?.phone) {
    drawText(ctx, `${labels.tel} ${profile.phone}`, { x: MARGIN, size: 9 });
    newLine(ctx, 11);
  }
  if (profile?.fiscal_id) {
    drawText(ctx, `${labels.tax_id} ${profile.fiscal_id}`, { x: MARGIN, size: 9 });
    newLine(ctx, 11);
  }

  // Invoice number + issued date in the right column. We draw these
  // at fixed y positions (relative to the page top) so they line up
  // with the shop-name baseline regardless of the address height.
  const headerRight = PAGE_W - MARGIN;
  const numberStr = `${labels.number} ${invoice.number}`;
  const dateStr = `${labels.date} ${invoice.issued_at.slice(0, 10)}`;
  // Save current y, draw at fixed positions, then restore.
  const savedY = ctx.y;
  ctx.y = PAGE_H - MARGIN - 28;
  drawText(ctx, numberStr, { x: headerRight, rightAlign: true, bold: true, size: 10 });
  ctx.y = PAGE_H - MARGIN - 42;
  drawText(ctx, dateStr, { x: headerRight, rightAlign: true, size: 9 });
  ctx.y = savedY;

  newLine(ctx, 16);
  drawHRule(ctx);
  newLine(ctx, 14);

  // ─── Customer block ───────────────────────────────────────────────
  drawText(ctx, labels.bill_to, { x: MARGIN, bold: true, size: 10 });
  newLine(ctx, 12);
  drawText(ctx, invoice.customer_name ?? labels.walk_in, { x: MARGIN, size: 10 });
  newLine(ctx, 11);
  if (invoice.customer_address) {
    for (const line of invoice.customer_address.split('\n')) {
      drawText(ctx, line, { x: MARGIN, size: 9 });
      newLine(ctx, 11);
    }
  }
  if (invoice.customer_fiscal_id) {
    drawText(ctx, `${labels.tax_id} ${invoice.customer_fiscal_id}`, { x: MARGIN, size: 9 });
    newLine(ctx, 11);
  }

  newLine(ctx, 8);
  drawHRule(ctx);
  newLine(ctx, 14);

  // ─── Line table ───────────────────────────────────────────────────
  const COL_DESC = MARGIN;
  const COL_QTY_R = MARGIN + 320;
  const COL_PRICE_R = MARGIN + 400;
  const COL_TOTAL_R = PAGE_W - MARGIN;

  drawText(ctx, labels.description, { x: COL_DESC, bold: true, size: 9 });
  drawText(ctx, labels.qty, { x: COL_QTY_R, rightAlign: true, bold: true, size: 9 });
  drawText(ctx, labels.unit, { x: COL_PRICE_R, rightAlign: true, bold: true, size: 9 });
  drawText(ctx, labels.total_col, { x: COL_TOTAL_R, rightAlign: true, bold: true, size: 9 });
  newLine(ctx, 6);
  drawHRule(ctx);
  newLine(ctx, 12);

  for (const line of invoice.lines) {
    drawText(ctx, line.description, { x: COL_DESC, size: 10 });
    drawText(ctx, String(line.qty), { x: COL_QTY_R, rightAlign: true, size: 10 });
    drawText(ctx, formatMoney(line.unit_price_minor, invoice.currency), {
      x: COL_PRICE_R,
      rightAlign: true,
      size: 10,
    });
    drawText(ctx, formatMoney(line.qty * line.unit_price_minor, invoice.currency), {
      x: COL_TOTAL_R,
      rightAlign: true,
      size: 10,
    });
    if (line.reference) {
      newLine(ctx, 10);
      drawText(ctx, line.reference, { x: COL_DESC, size: 8 });
    }
    newLine(ctx, 14);
  }

  newLine(ctx, 4);
  drawHRule(ctx);
  newLine(ctx, 14);

  // ─── Totals (right-aligned column) ────────────────────────────────
  drawText(ctx, labels.subtotal, { x: COL_PRICE_R, rightAlign: true, size: 10 });
  drawText(ctx, formatMoney(invoice.subtotal_minor, invoice.currency), {
    x: COL_TOTAL_R,
    rightAlign: true,
    size: 10,
  });
  newLine(ctx);
  drawText(ctx, `${labels.vat} (${invoice.vat_pct}%)`, {
    x: COL_PRICE_R,
    rightAlign: true,
    size: 10,
  });
  drawText(ctx, formatMoney(invoice.vat_minor, invoice.currency), {
    x: COL_TOTAL_R,
    rightAlign: true,
    size: 10,
  });
  newLine(ctx, 6);
  drawHRule(ctx);
  newLine(ctx, 12);
  drawText(ctx, labels.total, { x: COL_PRICE_R, rightAlign: true, bold: true, size: 12 });
  drawText(ctx, formatMoney(invoice.total_minor, invoice.currency), {
    x: COL_TOTAL_R,
    rightAlign: true,
    bold: true,
    size: 12,
  });

  if (invoice.notes) {
    newLine(ctx, 24);
    drawText(ctx, labels.notes, { x: MARGIN, bold: true, size: 9 });
    newLine(ctx, 12);
    for (const ln of invoice.notes.split('\n')) {
      drawText(ctx, ln, { x: MARGIN, size: 9 });
      newLine(ctx, 11);
    }
  }

  return doc.save();
}

export function invoicePdfFilename(invoice: Invoice): string {
  return `${invoice.number}.pdf`;
}
