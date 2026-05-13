import { useEffect, useRef, useState, type ReactNode } from 'react';
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
// Animation strategy:
//   1. Closed:      height = 0
//   2. Opening:     height = measured scrollHeight (transition from 0)
//   3. Open + done: height = auto (lets nested content keep growing —
//                   autosave badges, async logos, dynamic completion
//                   rings — without re-measurement)
//   4. Closing:     snapshot current height, then transition back to 0
//
// We tried the CSS grid 1fr ↔ 0fr trick first; in practice it clipped
// tall content in Shop Identity (8 subsections, ~3000px) because
// `1fr` with no explicit container height resolved smaller than the
// content's max-content. The transitionend + auto-height approach
// pins the final state to "natural height" and works in every browser.
//
// RTL: lucide's ChevronRight points right; mirror it horizontally for
// Arabic so it always points toward the body, then rotate 90° on open.

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

type BodyHeight = number | 'auto';

export function SettingsSection({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: SettingsSectionProps): JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // `height` drives the inline style: 0 when closed, a pixel value
  // during the transition, 'auto' once fully open (so dynamic content
  // inside the body can keep pushing the section taller without
  // forcing us to re-measure). 'auto' is non-transitionable — we snap
  // to a measured pixel value just before closing so the close
  // animation has a starting point.
  const [height, setHeight] = useState<BodyHeight>(open ? 'auto' : 0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (open) {
      // Snapshot the natural content height so the 0 → measured
      // transition has a target. Run on the next frame so the
      // child layout has settled before we read scrollHeight.
      const id = window.requestAnimationFrame(() => {
        setHeight(el.scrollHeight);
      });
      return () => window.cancelAnimationFrame(id);
    }
    // Closing path: if we're currently in 'auto' mode we'd snap to 0
    // and skip the transition. Take a measurement first, commit it
    // synchronously, then schedule the transition to 0 on the next
    // frame so the browser registers the intermediate value.
    if (height === 'auto') {
      setHeight(el.scrollHeight);
      const id = window.requestAnimationFrame(() => {
        setHeight(0);
      });
      return () => window.cancelAnimationFrame(id);
    }
    setHeight(0);
    // We intentionally don't depend on `height` — only on `open` —
    // because the closing path reads it once at the start of the
    // effect to decide whether to snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleTransitionEnd(): void {
    // After the open transition lands at the snapshotted pixel value,
    // promote to 'auto' so the body can grow with its content from
    // here on out. The close transition lands at 0 and stays.
    if (open) setHeight('auto');
  }

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
      <div
        id={`section-${id}-body`}
        data-testid={`section-${id}-body`}
        aria-hidden={!open}
        style={{ height: height === 'auto' ? 'auto' : `${height}px` }}
        onTransitionEnd={handleTransitionEnd}
        className="overflow-hidden transition-[height] duration-[250ms] ease-out"
      >
        <div ref={bodyRef} className="border-hair border-t px-4 py-4">
          {children}
        </div>
      </div>
    </section>
  );
}
