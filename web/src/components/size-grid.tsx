import { useLocale } from '../hooks/use-locale';
import { formatNumber } from '../i18n/format-number';
import { type SizeGridCell } from '../repos/quantity';

interface SizeGridProps {
  cells: SizeGridCell[];
  // Size that should get the cognac highlight — typically the size token
  // the user came from on the search screen.
  focusSize?: string | null;
  onCellClick: (cell: SizeGridCell) => void;
}

export function SizeGrid({ cells, focusSize, onCellClick }: SizeGridProps): JSX.Element {
  const { locale } = useLocale();
  const visible = cells.filter((c) => !c.hidden);
  return (
    <div data-testid="size-grid" className="grid grid-cols-5 gap-1.5">
      {visible.map((c) => {
        const state = c.qty > 0 ? 'has' : 'zero';
        const focus = focusSize === c.size;
        return (
          <button
            key={c.variant_id}
            type="button"
            data-testid={`size-cell-${c.size}`}
            data-state={focus ? 'focus' : state}
            data-qty={c.qty}
            onClick={() => onCellClick(c)}
            className={[
              'flex aspect-[1/1.05] flex-col items-center justify-center gap-0.5 rounded-xl border bg-white',
              focus
                ? 'bg-accent-soft border-accent text-accent-ink shadow-[0_0_0_3px_rgba(184,100,44,0.12)]'
                : state === 'has'
                  ? 'bg-ok-soft border-ok/20 text-ok'
                  : 'border-hair text-ink-3 opacity-60',
            ].join(' ')}
          >
            <span className="font-mono text-[13px] font-semibold tabular-nums" dir="ltr">
              {c.size}
            </span>
            <span
              data-testid={`size-${c.size}-qty`}
              className="font-mono text-[9.5px] tabular-nums"
              dir="ltr"
            >
              {formatNumber(c.qty, locale)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
