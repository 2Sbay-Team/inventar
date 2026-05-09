import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { useLocale } from '../hooks/use-locale';
import { formatNumber } from '../i18n/format-number';

interface SearchBarProps {
  // Caller-controlled query so the screen owns the URL/state if it wants to.
  value: string;
  onChange: (next: string) => void;
  // Live result count rendered next to the input. Hidden when null/empty
  // query so the empty state doesn't say "0 found".
  count?: number | undefined;
  // Debounce window — SPEC §2.2 specifies 150 ms. Override only in tests.
  debounceMs?: number;
}

export function SearchBar({
  value,
  onChange,
  count,
  debounceMs = 150,
}: SearchBarProps): JSX.Element {
  const { t } = useTranslation('search');
  const { locale } = useLocale();
  const [localValue, setLocalValue] = useState(value);
  const timer = useRef<number | null>(null);

  // Keep the controlled input in sync if the parent resets it. Cancel any
  // pending debounce timer too, otherwise it would fire later and clobber
  // the parent's new value (e.g. after a recent-chip click).
  useEffect(() => {
    setLocalValue(value);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, [value]);

  function handleChange(next: string): void {
    setLocalValue(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(next), debounceMs);
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div
      data-testid="search-bar"
      className="border-hair mx-4 mt-3 flex items-center gap-3 rounded-2xl border bg-paper px-4 py-3"
    >
      <SearchIcon aria-hidden className="text-ink-3 h-4 w-4 flex-shrink-0" strokeWidth={2} />
      <input
        data-testid="search-input"
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={t('placeholder')}
        className="placeholder:text-ink-3 flex-1 bg-transparent text-sm text-ink outline-none"
      />
      {typeof count === 'number' && localValue.trim().length > 0 ? (
        <span data-testid="search-count" className="text-ink-3 font-mono text-[11px]">
          {t('count', { n: formatNumber(count, locale) })}
        </span>
      ) : null}
    </div>
  );
}
