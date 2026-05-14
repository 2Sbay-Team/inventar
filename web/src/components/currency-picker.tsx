// Searchable currency picker presented as a bottom sheet (Dialog).
// Replaces the plain <select> in Settings → Shop profile so merchants
// can quickly find any of the 150+ ISO 4217 currencies without scrolling
// through an alphabetical list that starts at AED.
//
// Layout:
//   trigger button  →  shows current code + name
//   ─────────────────────────────────────────────
//   bottom sheet:
//     🔍 search input
//     PRIORITY currencies (TND, EUR, USD …)
//     ── divider ──
//     ALL remaining currencies A–Z
//
// The priority section stays at the top whenever the search is empty.
// When the merchant types, both sections are filtered and the divider
// is hidden so results read as one continuous list.

import { useRef, useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, Search, X, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listSupportedCurrencies, getCurrencyName, PRIORITY_CURRENCIES } from '../i18n/currency';
import { type CurrencyCode } from '../types';

interface CurrencyPickerProps {
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
  // data-testid for the trigger button; defaults to 'currency-picker-btn'.
  testId?: string;
}

interface RowProps {
  code: CurrencyCode;
  name: string;
  selected: boolean;
  onSelect: (code: CurrencyCode) => void;
}

function CurrencyRow({ code, name, selected, onSelect }: RowProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={`currency-option-${code}`}
      onClick={() => onSelect(code)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-ink/[0.04] active:bg-ink/[0.08]"
    >
      <span className="font-display min-w-0 flex-1 text-sm text-ink">
        <span className="font-semibold">{code}</span>
        <span className="text-ink-3 ml-2 truncate text-[12px]">{name}</span>
      </span>
      {selected ? (
        <Check aria-hidden className="text-accent h-4 w-4 flex-shrink-0" strokeWidth={2.5} />
      ) : null}
    </button>
  );
}

export function CurrencyPicker({ value, onChange, testId }: CurrencyPickerProps): JSX.Element {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const allCurrencies = useMemo(() => listSupportedCurrencies(), []);
  const currentName = useMemo(() => getCurrencyName(value), [value]);

  // Partition into priority and rest, filtered by search query.
  const { priority, rest } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (code: CurrencyCode): boolean => {
      if (!q) return true;
      return code.toLowerCase().includes(q) || getCurrencyName(code).toLowerCase().includes(q);
    };
    const allSet = new Set(allCurrencies);
    const priority = PRIORITY_CURRENCIES.filter((code) => allSet.has(code) && matches(code));
    const prioritySet = new Set(PRIORITY_CURRENCIES);
    const rest = allCurrencies.filter((code) => !prioritySet.has(code) && matches(code));
    return { priority, rest };
  }, [search, allCurrencies]);

  // Whether to show the divider between the two sections.
  const showDivider = !search && priority.length > 0 && rest.length > 0;

  function select(code: CurrencyCode): void {
    onChange(code);
    setOpen(false);
    setSearch('');
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) setSearch('');
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          data-testid={testId ?? 'currency-picker-btn'}
          className="border-hair flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-start text-sm"
        >
          <span className="flex-1 font-semibold text-ink">{value}</span>
          <span className="text-ink-3 flex-1 truncate text-[12px]">{currentName}</span>
          <ChevronRight aria-hidden className="h-4 w-4 flex-shrink-0 text-ink-3" strokeWidth={2} />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/25 backdrop-blur-[2px]" />
        <Dialog.Content
          data-testid="currency-picker-dialog"
          // Focus the search input instead of the first focusable element
          // so the merchant can start typing immediately.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
          className="fixed inset-x-0 bottom-0 z-[201] flex max-h-[85dvh] flex-col rounded-t-2xl bg-paper pb-[env(safe-area-inset-bottom)] outline-none"
        >
          {/* Sheet handle + header */}
          <div className="flex flex-col gap-3 px-4 pt-3 pb-2">
            <div className="mx-auto h-1 w-10 rounded-full bg-ink/20" />
            <div className="flex items-center justify-between">
              <Dialog.Title className="font-display text-base font-semibold text-ink">
                {t('currency')}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label={tCommon('close')}
                  className="text-ink-3 hover:text-ink rounded-full p-1"
                >
                  <X aria-hidden className="h-5 w-5" strokeWidth={2} />
                </button>
              </Dialog.Close>
            </div>

            {/* Search input */}
            <div className="border-hair relative flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5">
              <Search aria-hidden className="h-4 w-4 flex-shrink-0 text-ink-3" strokeWidth={2} />
              <input
                ref={searchRef}
                data-testid="currency-search-input"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('currency_search_placeholder')}
                className="text-ink placeholder:text-ink-3 min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              />
              {search ? (
                <button
                  type="button"
                  aria-label={tCommon('close')}
                  onClick={() => setSearch('')}
                  className="text-ink-3 hover:text-ink flex-shrink-0"
                >
                  <X aria-hidden className="h-4 w-4" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          </div>

          {/* Scrollable currency list */}
          <div className="flex-1 overflow-y-auto px-1 pb-2">
            {priority.length === 0 && rest.length === 0 ? (
              <p className="text-ink-3 py-8 text-center text-sm">{t('currency_no_results')}</p>
            ) : (
              <>
                {priority.length > 0 ? (
                  <div data-testid="currency-priority-list">
                    {priority.map((code) => (
                      <CurrencyRow
                        key={code}
                        code={code}
                        name={getCurrencyName(code)}
                        selected={code === value}
                        onSelect={select}
                      />
                    ))}
                  </div>
                ) : null}

                {showDivider ? (
                  <div data-testid="currency-divider" className="border-hair mx-3 my-1 border-t" />
                ) : null}

                {rest.length > 0 ? (
                  <div data-testid="currency-all-list">
                    {rest.map((code) => (
                      <CurrencyRow
                        key={code}
                        code={code}
                        name={getCurrencyName(code)}
                        selected={code === value}
                        onSelect={select}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
