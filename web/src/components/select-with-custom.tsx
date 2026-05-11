import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// v0.6 ADR-028 — single-select dropdown with a "+ Type your own" fallback that
// swaps the dropdown for an inline text input. Used by onboarding's
// locations step and Settings → Stock locations. Stays under 100 lines
// because the spec is small: 3 predefined options + one custom slot.
//
// Behaviour:
//   • When `value` matches one of `options`, render the native <select>
//     with that option selected.
//   • When `value` is empty OR not in `options`, render in custom mode
//     with the text input pre-filled from `value`. This gracefully
//     handles legacy migrated profiles whose stored label (e.g. "Shelf"
//     for shop+en) isn't in the new option list — the merchant sees
//     their existing value, can keep it or replace it.
//   • Picking the special "+ Type your own" option swaps to custom mode
//     with an empty input focused. Caller is notified via onChange when
//     the input blurs or Enter is pressed.

const CUSTOM_SENTINEL = '__custom__';
const MAX_LENGTH = 30;

interface SelectWithCustomProps {
  id?: string;
  // Unique testid root. The component emits:
  //   {testId}-select       — the native <select> (predefined mode)
  //   {testId}-custom-input — the text input (custom mode)
  testId: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  // Optional: forced direction. Defaults to the page's i18n direction
  // when omitted, which suits both LTR (en / fr) and RTL (ar) callers.
  dir?: 'ltr' | 'rtl';
  ariaLabel?: string;
}

export function SelectWithCustom({
  id,
  testId,
  value,
  onChange,
  options,
  dir,
  ariaLabel,
}: SelectWithCustomProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const resolvedDir = dir ?? (i18n.dir(i18n.language) === 'rtl' ? 'rtl' : 'ltr');
  // The "+ Type your own" label is the only string here that the
  // merchant sees but doesn't store. Everything else (the options) is
  // both the visible label AND the stored value.
  const customLabel = t('common:select_custom');

  const valueIsPredefined = options.includes(value);
  const [customMode, setCustomMode] = useState<boolean>(!valueIsPredefined);
  const [draft, setDraft] = useState<string>(valueIsPredefined ? '' : value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync if the value prop changes from outside (e.g. settings load
  // resolves async after first paint). The component is controlled, so
  // staying in lockstep with the parent's source of truth matters.
  useEffect(() => {
    if (options.includes(value)) {
      setCustomMode(false);
      setDraft('');
    } else {
      setCustomMode(true);
      setDraft(value);
    }
  }, [value, options]);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const next = e.target.value;
    if (next === CUSTOM_SENTINEL) {
      setCustomMode(true);
      setDraft('');
      // Defer the focus so the input has time to mount.
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    onChange(next);
  }

  function commitCustom(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      // Empty custom value reverts to the first predefined option so
      // the field can't end up blank on the way out of the picker.
      onChange(options[0] ?? '');
      setCustomMode(false);
      return;
    }
    onChange(trimmed);
  }

  if (customMode) {
    return (
      <input
        ref={inputRef}
        id={id}
        type="text"
        dir={resolvedDir}
        data-testid={`${testId}-custom-input`}
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitCustom}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitCustom();
          }
        }}
        maxLength={MAX_LENGTH}
        className="border-hair w-full rounded-xl border bg-white px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
    );
  }

  return (
    <select
      id={id}
      dir={resolvedDir}
      data-testid={`${testId}-select`}
      aria-label={ariaLabel}
      value={value}
      onChange={handleSelectChange}
      className="border-hair w-full rounded-xl border bg-white px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
      <option value={CUSTOM_SENTINEL}>{customLabel}</option>
    </select>
  );
}
