// v0.5 ADR-018: barcode validation at the /receive and /sell input
// boundary. Loose by design — we accept any 12- or 13-digit string and
// store it verbatim. Strict EAN-13 checksum validation is deferred to a
// follow-up ADR; the brief's test fixtures and a fair share of
// real-world Tunisian retail barcodes use non-standard or in-house
// codes that wouldn't pass a strict check, so rejecting at the door
// would create more friction than it would catch errors.
//
// What we DO reject:
//   - empty / whitespace-only input
//   - any non-digit character (after stripping common whitespace)
//   - wrong length (must be 12 = UPC-A or 13 = EAN-13)
//
// What we DON'T reject (yet):
//   - checksum mismatches
//   - duplicate barcode_ean across articles (caught higher up if we ever
//     decide to enforce uniqueness)

const DIGIT_ONLY = /^\d+$/;

// Strip all whitespace; some scanners emit leading/trailing spaces or
// embedded NBSP characters. Returns the cleaned string for downstream
// validation + storage.
export function normalizeEan(input: string): string {
  return input.replace(/\s+/g, '');
}

// True if the (normalized) value is a syntactically plausible EAN-13 or
// UPC-A: 12 or 13 ASCII digits. Does NOT verify the checksum digit.
export function isPlausibleScannableCode(input: string): boolean {
  const v = normalizeEan(input);
  if (v.length !== 12 && v.length !== 13) return false;
  return DIGIT_ONLY.test(v);
}

// Computes the EAN-13 checksum digit for the first 12 digits of the
// input. Exported for the strict-validation path. Throws if input
// isn't 12 digits.
//
// Algorithm: weight = 1 for odd positions (1-indexed), 3 for even.
// Sum the weighted first-12 digits, then checksum = (10 − sum mod 10) mod 10.
export function ean13Checksum(twelveDigits: string): number {
  if (twelveDigits.length !== 12 || !DIGIT_ONLY.test(twelveDigits)) {
    throw new Error(`ean13Checksum requires exactly 12 digits, got ${twelveDigits}`);
  }
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const d = twelveDigits.charCodeAt(i) - 48; // '0' = 48
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

// Strict EAN-13 validator. Used by /receive and /sell when the
// merchant has opted in via Settings. UPC-A (12 digits) is REJECTED
// under strict mode — a merchant who stocks UPC-A items should leave
// the toggle off and rely on loose validation. Strict means: 13 ASCII
// digits, the 13th matches the EAN-13 checksum computed from the
// first 12.
export function isValidStrictEan13(input: string): boolean {
  const v = normalizeEan(input);
  if (v.length !== 13) return false;
  if (!DIGIT_ONLY.test(v)) return false;
  const expected = ean13Checksum(v.slice(0, 12));
  const actual = v.charCodeAt(12) - 48;
  return expected === actual;
}
