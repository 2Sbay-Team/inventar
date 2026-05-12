import { type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

// Collapsible Settings section. Header is a single 56px tap target with
// the section name on the leading edge, an optional one-line summary
// on the trailing edge, and a chevron that rotates 90° when open.
//
// Open state is controlled by the parent — pass `open` + `onToggle`.
// That keeps localStorage persistence and "remember last state per
// section" logic in one place (the Settings screen) instead of
// fragmenting it across each accordion instance.
//
// Expansion uses the CSS grid `1fr ↔ 0fr` trick (Chrome 117+, Firefox
// 117+, Safari 17.1+ — all current PWA-capable runtimes). It animates
// directly from / to "the content's natural height", so dynamic body
// content — an autosave badge appearing, the completion ring
// re-rendering, an image finishing decode — pushes the section open
// without any JS measurement. Before this we measured scrollHeight
// once on toggle, locked the body to that pixel value, and anything
// that grew after the measurement (async logo load, deferred autosave
// chrome) got clipped — exactly the "last rows partially hidden"
// regression the merchant reported.
//
// RTL handling: lucide's ChevronRight points right by default. In
// Arabic we mirror it horizontally so it points toward the body in
// both writing directions. The 90° rotate-on-open stacks on top.

interface SettingsSectionProps {
  // Unique id, used both for localStorage and for the data-testid.
  // Kept the same as the legacy `section-<id>` testid scheme so
  // existing e2e tests + screen readers don't need updating.
  id: string;
  // Section name shown on the leading edge of the header. Localised
  // by the caller; we pass it through verbatim.
  title: string;
  // Optional one-line summary on the trailing edge. Empty / null /
  // undefined → only the chevron renders on the right side.
  summary?: string | null;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function SettingsSection({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: SettingsSectionProps): JSX.Element {
  return (
    <section
      data-testid={`section-${id}`}
      className="border-hair flex-shrink-0 rounded-2xl border bg-white"
    >
      <button
        type="button"
        data-testid={`section-${id}-header`}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`section-${id}-body`}
        className="flex h-14 w-full items-center gap-3 px-4 text-start"
      >
        <span className="font-display flex-1 text-sm font-semibold text-ink">{title}</span>
        {summary ? (
          <span data-testid={`section-${id}-summary`} className="text-ink-3 truncate text-[12px]">
            {summary}
          </span>
        ) : null}
        <ChevronRight
          aria-hidden
          data-testid={`section-${id}-chevron`}
          className={`text-ink-3 h-5 w-5 flex-shrink-0 transition-transform duration-200 rtl:-scale-x-100 ${
            open ? 'rotate-90' : ''
          }`}
          strokeWidth={2}
        />
      </button>
      {/* Outer grid wrapper animates row 0fr → 1fr. The inner div has
          `overflow: hidden` + `min-height: 0` so its children clip
          cleanly during the transition without forcing a measured
          pixel height. */}
      <div
        id={`section-${id}-body`}
        data-testid={`section-${id}-body`}
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows] duration-[250ms] ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-hair border-t px-4 py-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
