import { useLocale } from '../hooks/use-locale';
import { formatNumber } from '../i18n/format-number';
import { formatQtyWithUom, type Uom } from '../config/article-traits';
import { type SizeGridCell } from '../repos/quantity';

interface SizeGridProps {
  cells: SizeGridCell[];
  // Size that should get the cognac highlight — typically the size token
  // the user came from on the search screen.
  focusSize?: string | null;
  onCellClick: (cell: SizeGridCell) => void;
  // v0.5.2.9 (UoM): article's UoM determines how each cell's qty is
  // formatted. Defaults to 'piece' for back-compat with screens that
  // don't yet pass it. Piece pass-through is identical to the prior
  // bare-integer behaviour.
  unitOfMeasure?: Uom;
}

export function SizeGrid({
  cells,
  focusSize,
  onCellClick,
  unitOfMeasure = 'piece',
}: SizeGridProps): JSX.Element {
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
              {(() => {
                const { value, suffix } = formatQtyWithUom(c.qty, unitOfMeasure);
                const num = formatNumber(value, locale);
                return suffix === '' ? num : `${num} ${suffix}`;
              })()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
