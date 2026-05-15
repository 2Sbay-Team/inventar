import type { Color, PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import * as ArabicReshaperLib from 'arabic-reshaper';
import amiriUrl from '@fontsource/amiri/files/amiri-arabic-400-normal.woff2?url';
import { type Invoice, type InvoiceLine, type Locale, type ShopProfile } from '../types';
import { balanceDueForInvoice, paidMinorForInvoice, paymentStatusForInvoice } from './invoices';

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

// v0.5.2.9 — format an InvoiceLine.qty (stored in smallest unit) with
// the line's UoM suffix. Mirrors formatQtyWithUom in article-traits
// but lives here so invoice-pdf stays free of a dependency on the
// React + Dexie helper module (the PDF renderer runs server-side in
// tests). Behaviour must stay aligned with formatQtyWithUom.
function formatLineQty(qty: number, uom: InvoiceLine['unit_of_measure']): string {
  const u = uom ?? 'piece';
  if (u === 'piece') return String(qty);
  if (u === 'g' || u === 'ml') return `${qty} ${u}`;
  // kg / l: large unit when ≥ 1, else smallest.
  const abs = Math.abs(qty);
  if (abs >= 1000) {
    const large = qty / 1000;
    const text = Number.isInteger(large) ? String(large) : large.toFixed(3).replace(/\.?0+$/, '');
    return `${text} ${u}`;
  }
  return `${qty} ${u === 'kg' ? 'g' : 'ml'}`;
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
  payment_status: string;
  paid: string;
  balance_due: string;
  due_date: string;
  status_unpaid: string;
  status_partially_paid: string;
  status_paid: string;
  status_overdue: string;
  status_cancelled: string;
  status_refunded: string;
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
    payment_status: 'Payment status',
    paid: 'Paid',
    balance_due: 'Balance due',
    due_date: 'Due date',
    status_unpaid: 'Unpaid',
    status_partially_paid: 'Partially paid',
    status_paid: 'Paid',
    status_overdue: 'Overdue',
    status_cancelled: 'Cancelled',
    status_refunded: 'Refunded',
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
    payment_status: 'Statut du paiement',
    paid: 'Payé',
    balance_due: 'Solde dû',
    due_date: 'Échéance',
    status_unpaid: 'Non payé',
    status_partially_paid: 'Partiellement payé',
    status_paid: 'Payé',
    status_overdue: 'En retard',
    status_cancelled: 'Annulé',
    status_refunded: 'Remboursé',
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
    payment_status: 'حالة الدفع',
    paid: 'المدفوع',
    balance_due: 'المبلغ المتبقي',
    due_date: 'تاريخ الاستحقاق',
    status_unpaid: 'غير مدفوع',
    status_partially_paid: 'مدفوع جزئياً',
    status_paid: 'مدفوع',
    status_overdue: 'متأخر',
    status_cancelled: 'ملغى',
    status_refunded: 'مسترجع',
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
  rgb: (red: number, green: number, blue: number) => Color;
}

interface DrawOpts {
  x: number;
  bold?: boolean;
  size?: number;
  // When true, x is treated as the RIGHT edge and the text is drawn
  // ending at that x. Used for Arabic / right-aligned columns.
  rightAlign?: boolean;
  // v0.5.2.8: when true, x is treated as the CENTER point and the
  // text is drawn centered on that x. Used for the centered header
  // (logo / store name / address / phone / fiscal id all align on
  // the page midline regardless of length).
  centerAlign?: boolean;
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
    const x = opts.centerAlign ? opts.x - width / 2 : opts.rightAlign ? opts.x - width : opts.x;
    ctx.page.drawText(rendered, {
      x,
      y: ctx.y,
      size,
      font: helv,
      color: ctx.rgb(0.12, 0.12, 0.13),
    });
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
  let cursorX = opts.centerAlign
    ? opts.x - totalWidth / 2
    : opts.rightAlign
      ? opts.x - totalWidth
      : opts.x;
  for (const p of prepared) {
    ctx.page.drawText(p.rendered, {
      x: cursorX,
      y: ctx.y,
      size,
      font: p.font,
      color: ctx.rgb(0.12, 0.12, 0.13),
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
    color: ctx.rgb(0.85, 0.85, 0.86),
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
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const { default: fontkit } = await import('@pdf-lib/fontkit');
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

  // ─── Logo (v0.5.2.7+v0.5.2.8): centered at the top of the page.
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
  // v0.5.2.8: logo box bumped from 48 → 80pt so the merchant's brand
  // is actually visible on a printed A4. Drawn centered, not left.
  const LOGO_BOX = 80;
  const CENTER_X = PAGE_W / 2;
  let topCursorY = PAGE_H - MARGIN;
  if (embeddedLogo) {
    const scale = Math.min(LOGO_BOX / embeddedLogo.width, LOGO_BOX / embeddedLogo.height);
    const w = embeddedLogo.width * scale;
    const h = embeddedLogo.height * scale;
    page.drawImage(embeddedLogo, {
      x: CENTER_X - w / 2,
      y: PAGE_H - MARGIN - h,
      width: w,
      height: h,
    });
    topCursorY = PAGE_H - MARGIN - h - 6;
  }

  const ctx: DrawCtx = {
    page,
    font,
    bold,
    arabic,
    y: topCursorY,
    doc,
    currency: invoice.currency,
    rgb,
  };

  // ─── Centered header: legal_name → address → phone → fiscal_id ────
  // v0.5.2.8: rebuilt as a centered block so the issuer's brand sits
  // at the top of the invoice the way most printed Tunisian /
  // Maghrebi receipts present it. The "INVOICE" / "FACTURE" / "فاتورة"
  // label sits below this block on its own line; the number + date
  // go to the right just before the customer block.
  drawText(ctx, profile?.legal_name ?? profile?.name ?? '', {
    x: CENTER_X,
    centerAlign: true,
    bold: true,
    size: 16,
  });
  newLine(ctx, 18);

  if (profile?.legal_address) {
    for (const line of profile.legal_address.split('\n')) {
      drawText(ctx, line, { x: CENTER_X, centerAlign: true, size: 9 });
      newLine(ctx, 11);
    }
  }
  if (profile?.phone) {
    drawText(ctx, `${labels.tel} ${profile.phone}`, {
      x: CENTER_X,
      centerAlign: true,
      size: 9,
    });
    newLine(ctx, 11);
  }
  if (profile?.fiscal_id) {
    drawText(ctx, `${labels.tax_id} ${profile.fiscal_id}`, {
      x: CENTER_X,
      centerAlign: true,
      size: 9,
    });
    newLine(ctx, 11);
  }

  // Centered "INVOICE" / "FACTURE" / "فاتورة" title.
  newLine(ctx, 6);
  drawText(ctx, labels.invoice, { x: CENTER_X, centerAlign: true, bold: true, size: 16 });
  newLine(ctx, 16);

  // Number (left) + date (right) on one row just above the customer block.
  drawText(ctx, `${labels.number} ${invoice.number}`, {
    x: MARGIN,
    bold: true,
    size: 10,
  });
  drawText(ctx, `${labels.date} ${invoice.issued_at.slice(0, 10)}`, {
    x: PAGE_W - MARGIN,
    rightAlign: true,
    size: 10,
  });
  newLine(ctx, 14);
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
    // v0.5.2.9 — qty column reads the line's unit_of_measure (snapshot
    // at issue time) and formats accordingly: piece stays as a bare
    // integer, kg / l render with the larger unit when ≥ 1, otherwise
    // fall back to g / ml.
    drawText(ctx, formatLineQty(line.qty, line.unit_of_measure), {
      x: COL_QTY_R,
      rightAlign: true,
      size: 10,
    });
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
  // v0.5.2.7: if VAT is disabled on this invoice, skip the VAT line
  // entirely. Older invoices have no vat_enabled field — treat that
  // as `true` so historical PDFs print exactly as they did before.
  const vatShown = invoice.vat_enabled ?? true;
  drawText(ctx, labels.subtotal, { x: COL_PRICE_R, rightAlign: true, size: 10 });
  drawText(ctx, formatMoney(invoice.subtotal_minor, invoice.currency), {
    x: COL_TOTAL_R,
    rightAlign: true,
    size: 10,
  });
  if (vatShown) {
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
  }
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

  const paymentStatus = paymentStatusForInvoice(invoice);
  const paidMinor = paidMinorForInvoice(invoice);
  const balanceDue = balanceDueForInvoice(invoice);
  const statusLabel = labels[`status_${paymentStatus}` as keyof PdfLabels] ?? paymentStatus;
  newLine(ctx, 16);
  drawText(ctx, labels.payment_status, { x: COL_PRICE_R, rightAlign: true, size: 9 });
  drawText(ctx, String(statusLabel), { x: COL_TOTAL_R, rightAlign: true, size: 9 });
  newLine(ctx, 11);
  drawText(ctx, labels.paid, { x: COL_PRICE_R, rightAlign: true, size: 9 });
  drawText(ctx, formatMoney(paidMinor, invoice.currency), {
    x: COL_TOTAL_R,
    rightAlign: true,
    size: 9,
  });
  newLine(ctx, 11);
  drawText(ctx, labels.balance_due, {
    x: COL_PRICE_R,
    rightAlign: true,
    bold: balanceDue > 0,
    size: 9,
  });
  drawText(ctx, formatMoney(balanceDue, invoice.currency), {
    x: COL_TOTAL_R,
    rightAlign: true,
    bold: balanceDue > 0,
    size: 9,
  });
  if (balanceDue > 0 && invoice.due_at) {
    newLine(ctx, 11);
    drawText(ctx, labels.due_date, { x: COL_PRICE_R, rightAlign: true, size: 9 });
    drawText(ctx, new Date(invoice.due_at).toLocaleDateString(locale), {
      x: COL_TOTAL_R,
      rightAlign: true,
      size: 9,
    });
  }

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
