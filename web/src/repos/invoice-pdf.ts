import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { type Invoice, type ShopProfile } from '../types';

// v0.5.2.5 ADR-024 — render an Invoice into a real PDF byte stream so
// the merchant can attach it to WhatsApp / email / Drive via the OS
// share sheet. Browser-print stays as a fallback.
//
// Font choice: pdf-lib's StandardFonts.Helvetica is built into every
// PDF reader (no font embedding, no extra bytes shipped). The trade-off
// is that Helvetica only covers Latin-1 — Arabic / Cyrillic / CJK glyphs
// render as boxes. To keep the PDF readable for everyone in this commit
// we render the labels in English regardless of the app locale; the
// merchant's data (shop name, customer name, items) prints verbatim and
// is fine if it uses Latin script. ADR-024 follow-up: embed Noto Sans
// Arabic for full RTL support.

interface RenderOptions {
  invoice: Invoice;
  profile: ShopProfile | null;
}

const PAGE_W = 595; // A4 width in points
const PAGE_H = 842; // A4 height in points
const MARGIN = 48;
const LINE_GAP = 14;

// Helvetica covers Latin-1 only. We strip anything outside that range to
// avoid pdf-lib's WinAnsi encoder throwing on emoji / Arabic / CJK. The
// shopkeeper's data still renders as long as they used Latin script;
// non-Latin runs fall back to '?' rather than crashing the export.
function safeText(input: string | null | undefined): string {
  if (input == null) return '';
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    out += code <= 0xff ? ch : '?';
  }
  return out;
}

function formatMoney(minor: number, currency: string): string {
  // Force English-style formatting for the PDF since the labels are
  // English anyway. Three fractional digits matches TND millimes
  // convention; Intl picks the right separator for the requested
  // currency under the 'en' locale.
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(minor / 1000);
}

interface DrawCtx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
  doc: PDFDocument;
  currency: string;
}

function drawText(
  ctx: DrawCtx,
  text: string,
  opts: { x: number; bold?: boolean; size?: number },
): void {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.bold : ctx.font;
  ctx.page.drawText(safeText(text), {
    x: opts.x,
    y: ctx.y,
    size,
    font,
    color: rgb(0.12, 0.12, 0.13),
  });
}

function newLine(ctx: DrawCtx, by: number = LINE_GAP): void {
  ctx.y -= by;
  // Page break — start a new page if we've fallen below the bottom margin.
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

export async function renderInvoicePdf({ invoice, profile }: RenderOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: DrawCtx = {
    page,
    font,
    bold,
    y: PAGE_H - MARGIN,
    doc,
    currency: invoice.currency,
  };

  // ─── Header: shop info (left) + INVOICE label + number (right) ───
  drawText(ctx, profile?.legal_name ?? profile?.name ?? '', {
    x: MARGIN,
    bold: true,
    size: 14,
  });
  drawText(ctx, 'INVOICE', { x: PAGE_W - MARGIN - 80, bold: true, size: 16 });
  newLine(ctx, 20);

  if (profile?.legal_address) {
    for (const line of profile.legal_address.split('\n')) {
      drawText(ctx, line, { x: MARGIN, size: 9 });
      newLine(ctx, 11);
    }
  }
  if (profile?.fiscal_id) {
    drawText(ctx, `Tax ID: ${profile.fiscal_id}`, { x: MARGIN, size: 9 });
    newLine(ctx, 11);
  }

  // Invoice number + issued date in the right column.
  const headerRight = PAGE_W - MARGIN - 200;
  ctx.page.drawText(safeText(`No. ${invoice.number}`), {
    x: headerRight,
    y: PAGE_H - MARGIN - 28,
    size: 10,
    font: bold,
  });
  ctx.page.drawText(safeText(`Date: ${invoice.issued_at.slice(0, 10)}`), {
    x: headerRight,
    y: PAGE_H - MARGIN - 42,
    size: 9,
    font,
  });

  newLine(ctx, 16);
  drawHRule(ctx);
  newLine(ctx, 14);

  // ─── Customer block ─────────────────────────────────────────────
  drawText(ctx, 'Bill to:', { x: MARGIN, bold: true, size: 10 });
  newLine(ctx, 12);
  drawText(ctx, invoice.customer_name ?? 'Walk-in customer', { x: MARGIN, size: 10 });
  newLine(ctx, 11);
  if (invoice.customer_address) {
    for (const line of invoice.customer_address.split('\n')) {
      drawText(ctx, line, { x: MARGIN, size: 9 });
      newLine(ctx, 11);
    }
  }
  if (invoice.customer_fiscal_id) {
    drawText(ctx, `Tax ID: ${invoice.customer_fiscal_id}`, { x: MARGIN, size: 9 });
    newLine(ctx, 11);
  }

  newLine(ctx, 8);
  drawHRule(ctx);
  newLine(ctx, 14);

  // ─── Line table header ──────────────────────────────────────────
  const COL_DESC = MARGIN;
  const COL_QTY = MARGIN + 290;
  const COL_PRICE = MARGIN + 340;
  const COL_TOTAL = MARGIN + 420;

  drawText(ctx, 'Description', { x: COL_DESC, bold: true, size: 9 });
  drawText(ctx, 'Qty', { x: COL_QTY, bold: true, size: 9 });
  drawText(ctx, 'Unit', { x: COL_PRICE, bold: true, size: 9 });
  drawText(ctx, 'Total', { x: COL_TOTAL, bold: true, size: 9 });
  newLine(ctx, 6);
  drawHRule(ctx);
  newLine(ctx, 12);

  for (const line of invoice.lines) {
    drawText(ctx, line.description, { x: COL_DESC, size: 10 });
    drawText(ctx, String(line.qty), { x: COL_QTY, size: 10 });
    drawText(ctx, formatMoney(line.unit_price_minor, invoice.currency), {
      x: COL_PRICE,
      size: 10,
    });
    drawText(ctx, formatMoney(line.qty * line.unit_price_minor, invoice.currency), {
      x: COL_TOTAL,
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

  // ─── Totals ─────────────────────────────────────────────────────
  drawText(ctx, 'Subtotal', { x: COL_PRICE, size: 10 });
  drawText(ctx, formatMoney(invoice.subtotal_minor, invoice.currency), {
    x: COL_TOTAL,
    size: 10,
  });
  newLine(ctx);
  drawText(ctx, `VAT (${invoice.vat_pct}%)`, { x: COL_PRICE, size: 10 });
  drawText(ctx, formatMoney(invoice.vat_minor, invoice.currency), { x: COL_TOTAL, size: 10 });
  newLine(ctx, 6);
  drawHRule(ctx);
  newLine(ctx, 12);
  drawText(ctx, 'TOTAL', { x: COL_PRICE, bold: true, size: 12 });
  drawText(ctx, formatMoney(invoice.total_minor, invoice.currency), {
    x: COL_TOTAL,
    bold: true,
    size: 12,
  });

  if (invoice.notes) {
    newLine(ctx, 24);
    drawText(ctx, 'Notes:', { x: MARGIN, bold: true, size: 9 });
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
