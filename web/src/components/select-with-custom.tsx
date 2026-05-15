import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// v0.6 ADR-029 — single-select dropdown with a "+ Type your own" fallback that
// swaps the dropdown for an inline text input. Used by onboarding's
// locations step and Settings → Stock locations. Stays under 100 lines
// because the spec is small: 3 predefined options + one custom slot.
//
// Mobile polish: custom mode now has an explicit placeholder + text colour.
// Previously the input could look blank after choosing "Type your own".

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
  const customLabel = t('common:select_custom');

  const valueIsPredefined = options.includes(value);
  const [customMode, setCustomMode] = useState<boolean>(!valueIsPredefined);
  const [draft, setDraft] = useState<string>(valueIsPredefined ? '' : value);
  const inputRef = useRef<HTMLInputElement>(null);

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
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    onChange(next);
  }

  function commitCustom(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      onChange(options[0] ?? '');
      setCustomMode(false);
      return;
    }
    onChange(trimmed);
  }

  if (customMode) {
    return (
      <div className="w-full">
        <input
          ref={inputRef}
          id={id}
          type="text"
          dir={resolvedDir}
          data-testid={`${testId}-custom-input`}
          aria-label={ariaLabel ?? customLabel}
          value={draft}
          placeholder={customLabel}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitCustom();
            }
          }}
          maxLength={MAX_LENGTH}
          className="border-hair text-ink placeholder:text-ink-3 w-full rounded-xl border bg-white px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
        {draft.trim() === '' ? <p className="text-ink-3 mt-1 text-[11px]">{customLabel}</p> : null}
      </div>
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
      className="border-hair text-ink w-full rounded-xl border bg-white px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
