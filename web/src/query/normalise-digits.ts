// DATA_MODEL §5: Eastern Arabic digits (U+0660..U+0669) → Western (0..9).
// Applied before indexing (in search_blob) AND on user input (in tokenise),
// so "أبيض ٤٢" and "white 42" canonicalise to the same form.

export function normaliseDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
