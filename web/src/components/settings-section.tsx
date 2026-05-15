import { type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

// Reliable Settings accordion.
// The previous version animated a measured height with scrollHeight + overflow-hidden.
// That clipped dynamic Settings content on mobile/desktop when QR previews, logos,
// selects, or async profile data changed after the first measurement.
// This version prioritises correctness: closed sections do not render their body,
// open sections render at their natural height with no clipping.

interface SettingsSectionProps {
  // Unique id, used both for localStorage and for the data-testid.
  id: string;
  // Localised section name shown on the leading edge of the header.
  title: string;
  // Optional one-line summary on the trailing edge.
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
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-start"
      >
        <span
          data-testid={`section-${id}-title`}
          className="font-display min-w-0 flex-1 truncate text-sm font-semibold text-ink"
        >
          {title}
        </span>

        {summary ? (
          <span
            data-testid={`section-${id}-summary`}
            className="text-ink-3 max-w-[42%] flex-shrink truncate text-[12px]"
          >
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

      {open ? (
        <div
          id={`section-${id}-body`}
          data-testid={`section-${id}-body`}
          className="border-hair border-t px-4 py-4"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
