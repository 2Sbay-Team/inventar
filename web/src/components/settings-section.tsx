import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

// Collapsible Settings section. Header is a single 56px tap target with
// the section name on the leading edge, an optional one-line summary
// on the trailing edge, and a chevron that rotates 90° when open. The
// body smoothly slides in/out over 250ms.
//
// Open state is controlled by the parent — pass `open` + `onToggle`.
// That keeps localStorage persistence and "remember last state per
// section" logic in one place (the Settings screen) instead of
// fragmenting it across each accordion instance.
//
// RTL handling: the chevron uses lucide's ChevronRight which is
// `dir="ltr"` by default in our app. Tailwind's `rtl:rotate-180`
// flips it to point left in Arabic, then the open-state rotation
// applies on top of that so it still rotates "down" visually when
// expanded in either direction.

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
  // Measured content height. Without this the CSS transition can't
  // animate to/from a known value (max-height: 100% / auto don't
  // transition). On open we measure the live content height each
  // time so dynamic body content (a freshly-uploaded logo, a newly-
  // added sub-type chip) doesn't get clipped.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState<number>(0);

  useEffect(() => {
    if (!open) {
      setBodyHeight(0);
      return;
    }
    const el = bodyRef.current;
    if (!el) return;
    // Initial measurement.
    setBodyHeight(el.scrollHeight);
    // Re-measure when content inside the body changes height (e.g.
    // the merchant types into an autosaved input, a banner appears).
    const observer = new ResizeObserver(() => {
      setBodyHeight(el.scrollHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  // After the header expands, nudge it back into view so the merchant
  // doesn't lose the title behind the on-screen keyboard or another
  // section. Runs after the transition so the scroll lands on the
  // final layout.
  const headerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      headerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 260);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <section
      data-testid={`section-${id}`}
      className="border-hair overflow-hidden rounded-2xl border bg-white"
    >
      <button
        ref={headerRef}
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
      <div
        id={`section-${id}-body`}
        data-testid={`section-${id}-body`}
        aria-hidden={!open}
        style={{ height: open ? bodyHeight : 0 }}
        className="overflow-hidden transition-[height] duration-[250ms] ease-out"
      >
        <div ref={bodyRef} className="border-hair border-t px-4 py-4">
          {children}
        </div>
      </div>
    </section>
  );
}
