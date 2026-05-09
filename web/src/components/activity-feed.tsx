import { useTranslation } from 'react-i18next';
import { useLocale } from '../hooks/use-locale';
import { formatNumber } from '../i18n/format-number';
import { type Locale, type Movement, type Variant } from '../types';

interface ActivityFeedProps {
  movements: Movement[];
  variantsById: Map<string, Variant>;
}

const EASTERN: readonly string[] = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

// ADR-006: user-facing numbers in AR render as Eastern Arabic numerals.
// Intl.DateTimeFormat with fr-TN gives Latin digits, so we substitute.
function shortTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate();
  const intlBase = locale === 'en' ? 'en-US' : 'fr-TN';
  const text = sameDay
    ? new Intl.DateTimeFormat(intlBase, { hour: '2-digit', minute: '2-digit' }).format(d)
    : new Intl.DateTimeFormat(intlBase, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      }).format(d);
  return locale === 'ar' ? text.replace(/[0-9]/g, (c) => EASTERN[Number(c)]!) : text;
}

export function ActivityFeed({ movements, variantsById }: ActivityFeedProps): JSX.Element {
  const { t } = useTranslation('article');
  const { locale }: { locale: Locale } = useLocale();
  if (movements.length === 0) {
    return (
      <ul data-testid="activity-feed" className="text-ink-3 text-xs">
        <li className="py-1">—</li>
      </ul>
    );
  }
  return (
    <ul data-testid="activity-feed" className="flex flex-col gap-1.5">
      {movements.map((m) => {
        const variant = variantsById.get(m.variant_id);
        const sign = m.delta < 0 ? 'minus' : 'plus';
        const deltaText =
          m.delta < 0
            ? `−${formatNumber(Math.abs(m.delta), locale)}`
            : `+${formatNumber(m.delta, locale)}`;
        return (
          <li
            key={m.id}
            data-testid="activity-row"
            className="border-hair text-ink-2 flex items-baseline justify-between border-b pb-1.5 text-[11.5px] last:border-0 last:pb-0"
          >
            <span>
              <span
                data-sign={sign}
                className={`font-mono font-semibold ${sign === 'minus' ? 'text-bad' : 'text-ok'} mr-1.5 tabular-nums`}
                dir="ltr"
              >
                {deltaText}
              </span>
              {variant?.size ? (
                <>
                  <span dir="ltr" className="font-mono">
                    {variant.size}
                  </span>
                  {' · '}
                </>
              ) : null}
              {t(`mtype_${m.type}`)}
            </span>
            <span className="text-ink-4 font-mono text-[10px]" dir="ltr">
              {shortTime(m.created_at, locale)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
