import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  Boxes,
  Camera,
  ChevronRight,
  Clock,
  Download,
  HardDrive,
  LifeBuoy,
  MapPin,
  Plus,
  Receipt,
  ScanLine,
  Search as SearchIcon,
  Settings as SettingsIcon,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import { ScreenLayout } from '../components/screen-layout';

interface Section {
  id: string;
  Icon: LucideIcon;
}

// Order matters — the user reads top to bottom. Daily flows first
// (add / sale / restock for fashion; receive / sell scan for shop),
// then alerts + lots (shop), then helpers (search, expenses), then
// safety (backup, multi-device), then customisation (locations,
// custom categories, profile, install), then troubleshooting at the
// bottom as the "if all else fails" landing.
const SECTIONS: ReadonlyArray<Section> = [
  { id: 'intro', Icon: Boxes },
  { id: 'article', Icon: Plus },
  { id: 'sale', Icon: Tag },
  { id: 'restock', Icon: Camera },
  { id: 'receive', Icon: ScanLine },
  { id: 'sell_scan', Icon: ShoppingCart },
  { id: 'lots', Icon: Clock },
  { id: 'alerts', Icon: Bell },
  { id: 'expense', Icon: Receipt },
  { id: 'search', Icon: SearchIcon },
  { id: 'locations', Icon: MapPin },
  { id: 'subtypes_custom', Icon: Sparkles },
  { id: 'backup', Icon: Download },
  { id: 'auto_backup', Icon: HardDrive },
  { id: 'multi_device', Icon: ChevronRight },
  { id: 'profile', Icon: SettingsIcon },
  { id: 'install', Icon: Smartphone },
  // v0.6 ADR-030 — update-consent flow questions.
  { id: 'updates_consent', Icon: Sparkles },
  { id: 'updates_skipping', Icon: Sparkles },
  { id: 'updates_server_down', Icon: Sparkles },
  { id: 'troubleshoot', Icon: LifeBuoy },
];

export function HelpScreen(): JSX.Element {
  const { t } = useTranslation('help');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();

  return (
    <ScreenLayout hideNav>
      <header className="border-hair flex flex-shrink-0 items-center gap-3 border-b bg-white px-4 py-3">
        <button
          type="button"
          data-testid="help-back"
          onClick={() => navigate(-1)}
          className="text-ink-2 hover:text-ink p-1"
          aria-label={tCommon('back')}
        >
          <ArrowLeft aria-hidden className="h-5 w-5" strokeWidth={2} />
        </button>
        <div>
          <h1 className="font-display text-ink text-lg font-semibold">{t('title')}</h1>
          <p className="text-ink-3 text-xs">{t('subtitle')}</p>
        </div>
      </header>

      <main
        data-testid="help-screen"
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {SECTIONS.map(({ id, Icon }) => (
          <section
            key={id}
            data-testid={`help-section-${id}`}
            className="border-hair rounded-2xl border bg-white p-4"
          >
            <div className="flex items-start gap-3">
              <div className="bg-accent-soft text-accent flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl">
                <Icon aria-hidden className="h-4 w-4" strokeWidth={2} />
              </div>
              <div className="flex-1">
                <h2 className="text-ink text-[15px] font-semibold leading-snug">
                  {t(`${id}_title`)}
                </h2>
                <p className="text-ink-2 mt-1 text-[13px] leading-relaxed">{t(`${id}_body`)}</p>
              </div>
            </div>
          </section>
        ))}
        <p className="text-ink-3 mt-2 text-center text-xs">{t('footer_note')}</p>
        {/* v0.5.2.1: link to the public tech-requirements page on
            hoodhood.ai. Helps a merchant whose app DOES load but who
            wants to check why a feature isn't working as expected.
            Opens in a new tab so the in-app session isn't lost. */}
        <p className="text-ink-3 mt-1 text-center text-[11px]">
          <a
            data-testid="help-requirements-link"
            href="https://hoodhood.ai/inventar"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            {t('requirements_link')}
          </a>
        </p>
      </main>
    </ScreenLayout>
  );
}
