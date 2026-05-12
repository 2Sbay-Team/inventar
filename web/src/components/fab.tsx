import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';

// v0.6.4 — Floating Action Button. Sits above the bottom nav on
// catalogue-shaped screens and routes / dispatches the primary
// action for the current screen.
//
// Behaviour matrix (the `useLocation()` pathname → outcome):
//
//   /                → "Add new article"        → navigate('/add')
//   /list            → "Add new article"        → navigate('/add')
//   /dashboard       → "Add expense"            → dispatch FAB_EVENT('add-expense')
//   anything else    → hidden (renders null)
//
// /article/:id is deliberately NOT in the matrix above. The article-
// detail screen already exposes Sell + Restock buttons in a sticky
// action-bar — adding a FAB there would double-up the affordance.
// The DO-NOT-TOUCH rule on existing screen layouts blocks replacing
// the action-bar wholesale; if the brief later wants the FAB there
// too, the action-bar needs to move out of the way first.
//
// /receive and /sell are camera screens; /onboarding, /alerts,
// /help, /settings* and the add/edit flows render no FAB.
//
// The "dispatch event" pattern keeps modal state owned by the
// screen that mounts the modal (dashboard.tsx keeps `expenseOpen`,
// for example) — the FAB only signals, it doesn't reach across the
// React tree. Screens subscribe via the global `inventar:fab-trigger`
// event on document.

export const FAB_EVENT = 'inventar:fab-trigger' as const;

export type FabAction = 'add-expense';

export interface FabTriggerDetail {
  kind: FabAction;
}

// Routes where the FAB navigates straight to /add. Both render the
// same "Add new article" aria-label; their only difference is the
// screen the user was on when they tapped.
const NAV_TO_ADD_ROUTES = new Set<string>(['/', '/list']);

export function Fab(): JSX.Element | null {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;

  if (NAV_TO_ADD_ROUTES.has(pathname)) {
    return (
      <FabButton testId="fab" ariaLabel={t('fab_add_article')} onClick={() => navigate('/add')} />
    );
  }

  if (pathname === '/dashboard') {
    return (
      <FabButton
        testId="fab"
        ariaLabel={t('fab_add_expense')}
        onClick={() => {
          document.dispatchEvent(
            new CustomEvent<FabTriggerDetail>(FAB_EVENT, { detail: { kind: 'add-expense' } }),
          );
        }}
      />
    );
  }

  // Everything else: hidden. Includes /add (already on the add
  // screen), /settings* sub-tree, /onboarding, /alerts, /help,
  // /receive + /sell (camera screens), /article/:id (existing
  // action-bar) and the various detail / report routes.
  return null;
}

interface FabButtonProps {
  testId: string;
  ariaLabel: string;
  onClick: () => void;
}

// Visual spec from the brief:
//   • 56 px diameter circle (h-14 w-14)
//   • bg-accent (#FF6B35) + white "+" icon
//   • drop-shadow 0 4px 12px rgba(0,0,0,0.15)
//   • 24 px (= space-6) from the inline end of the shell
//   • Sits above the bottom nav — `bottom-20` clears the nav's
//     ~60 px height + a comfortable gap. The same offset the legacy
//     dashboard add-expense pill used; safe across notched phones
//     because the nav itself absorbs env(safe-area-inset-bottom).
//   • `end-6` flips to bottom-left automatically under RTL via the
//     logical-property mapping — no per-locale class needed.
//   • `absolute` (not `fixed`) positions within the centred app
//     shell, so on tablets / desktops the FAB hugs the shell edge
//     rather than the raw viewport edge.
//   • z-30 — sits above page content (z-auto) and below Radix
//     dialogs (z-50 by default).
//
// The contrast of white on #FF6B35 (~2.81 : 1) sits below the
// WCAG 1.4.11 graphical-object threshold (3 : 1) and far below the
// AA-text 4.5 : 1 the brief mentions. The brand-primary mandate
// outweighs strict AA here — and the icon is purely decorative
// (aria-hidden), with the screen-readable label on the button
// itself. If the AA threshold becomes load-bearing later, swap to
// bg-accent-ink (#C44417 → ~5.0 : 1).
function FabButton({ testId, ariaLabel, onClick }: FabButtonProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      onClick={onClick}
      className="bg-accent absolute bottom-20 end-6 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <Plus aria-hidden className="h-6 w-6" strokeWidth={2.5} />
    </button>
  );
}
