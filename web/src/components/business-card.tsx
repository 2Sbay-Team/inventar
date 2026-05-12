import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Link as LinkIcon, Share2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useLogoDataUrl } from '../hooks/use-logo-data-url';
import { parseHex } from '../theme/apply-theme';
import { shareBusinessCard, type ShareResult } from '../utils/share-business-card';
import { whatsappHref } from '../utils/field-format';
import type { ShopProfile } from '../types';

// v0.9 Phase 6 — Digital Business Card.
//
// What's rendered: a self-contained card showing the merchant's
// brand identity, contact details, social handles, and a QR code
// that links to the future public catalogue at
// inventar.hoodhood.ai/shop/{slug}. The catalogue itself ships in
// v0.10 — until then the QR scans to a page-not-found stub. We
// render it now so the merchant has the card ready when the
// catalogue lands.
//
// Implementation constraints:
//
//   * 100% inline styles for visuals. Tailwind classes WON'T survive
//     the SVG-foreignObject serialisation the share-as-image
//     pipeline uses (no access to external stylesheets). Every
//     colour / font / spacing decision is set via `style={...}` so
//     the exported PNG matches what the merchant sees on screen.
//
//   * Brand colour reads `profile.brand_primary_color`, falling back
//     to the Inventar default. Bg reads `profile.theme_bg_color`,
//     same fallback. Phase 2's :root vars aren't reachable through
//     foreignObject so we resolve to hex here.

const DEFAULT_BRAND = '#FF6B35';
const DEFAULT_BG = '#FFF8F2';
const CARD_WIDTH = 320;
const CARD_HEIGHT = 440;

interface BusinessCardProps {
  profile: ShopProfile;
}

// The display card + the two action buttons. The buttons toast a
// short status string after firing — auto-clears after 3s so the
// merchant can re-trigger from the same view.
export function BusinessCard({ profile }: BusinessCardProps): JSX.Element {
  const { t } = useTranslation('settings');
  const cardRef = useRef<HTMLDivElement | null>(null);
  const logoDataUrl = useLogoDataUrl();
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Catalogue URL — the QR encodes this and "Copy link" copies it
  // verbatim. The slug uses the shop id so it's stable across
  // renames; the catalogue page in v0.10 looks the merchant up
  // by id.
  const catalogueUrl = useMemo(() => buildCatalogueUrl(profile), [profile]);

  // Generate the QR SVG asynchronously. The qrcode lib returns a
  // complete <svg>…</svg> string we can inject via
  // dangerouslySetInnerHTML; the colours are themed in line with
  // the rest of the card.
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(catalogueUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 0,
      color: { dark: '#1F2937', light: '#FFFFFF' },
    }).then((svg) => {
      if (cancelled) return;
      setQrSvg(svg);
    });
    return () => {
      cancelled = true;
    };
  }, [catalogueUrl]);

  // Auto-clear the toast after 3 seconds so a second action doesn't
  // see stale copy.
  useEffect(() => {
    if (toast === null) return;
    const handle = window.setTimeout(() => setToast(null), 3_000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  async function onShare(): Promise<void> {
    if (!cardRef.current || busy) return;
    setBusy(true);
    setToast(null);
    try {
      const result: ShareResult = await shareBusinessCard({
        node: cardRef.current,
        filename: `${slugify(profile.name) || 'business-card'}.png`,
        shareTitle: profile.name,
        shareText: profile.tagline ?? undefined,
      });
      if (result === 'shared') setToast(t('card_share_success'));
      else if (result === 'downloaded') setToast(t('card_download_success'));
      // cancelled: silent — the merchant chose to back out.
    } catch (err) {
      console.error('[business-card] share failed', err);
      setToast(t('card_share_error'));
    } finally {
      setBusy(false);
    }
  }

  // Copy-to-clipboard is intentionally always-on, NOT gated behind
  // the catalogue's v0.10 readiness. The URL works as a copy target
  // today; following it will yield a 404 until the catalogue ships,
  // but a merchant who's printing collateral now wants to bake the
  // URL into business cards / flyers in advance. Show a soft hint
  // about the catalogue's status so they're not surprised.
  async function onCopyLink(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setToast(null);
    try {
      await navigator.clipboard.writeText(catalogueUrl);
      setToast(t('card_copy_success'));
    } catch (err) {
      console.error('[business-card] copy failed', err);
      setToast(t('card_copy_error'));
    } finally {
      setBusy(false);
    }
  }

  const brandHex = parseHex(profile.brand_primary_color)
    ? profile.brand_primary_color!
    : DEFAULT_BRAND;
  const bgHex = parseHex(profile.theme_bg_color) ? profile.theme_bg_color! : DEFAULT_BG;

  return (
    <div className="space-y-3" data-testid="business-card-section">
      <div className="flex justify-center">
        <BusinessCardSurface
          ref={cardRef}
          profile={profile}
          brandHex={brandHex}
          bgHex={bgHex}
          logoDataUrl={logoDataUrl ?? null}
          qrSvg={qrSvg}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="business-card-share"
          onClick={() => void onShare()}
          disabled={busy}
          className="bg-accent text-paper inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <Share2 size={14} aria-hidden /> {t('card_share_action')}
        </button>
        <button
          type="button"
          data-testid="business-card-copy"
          onClick={() => void onCopyLink()}
          disabled={busy}
          className="border-hair inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm disabled:opacity-50"
        >
          <LinkIcon size={14} aria-hidden /> {t('card_copy_action')}
        </button>
        {toast !== null ? (
          <span
            data-testid="business-card-toast"
            className="text-ink-2 text-[11px]"
            role="status"
            aria-live="polite"
          >
            {toast}
          </span>
        ) : null}
      </div>
      <p className="text-ink-3 text-[11px] leading-relaxed">
        <Download size={11} className="inline mr-1 -mt-0.5" aria-hidden />
        {t('card_catalogue_pending')}
      </p>
    </div>
  );
}

// Locked to an HTMLDivElement so the share helper's foreignObject
// path receives a serialisable HTML subtree (not, say, an SVG node).
interface BusinessCardSurfaceProps {
  profile: ShopProfile;
  brandHex: string;
  bgHex: string;
  logoDataUrl: string | null;
  qrSvg: string | null;
}

const BusinessCardSurface = forwardRef<HTMLDivElement, BusinessCardSurfaceProps>(
  function BusinessCardSurface({ profile, brandHex, bgHex, logoDataUrl, qrSvg }, ref): JSX.Element {
    const lines = collectContactLines(profile);
    const socials = collectSocialLines(profile);
    // 5%-darker bottom for the gradient — matches applyTheme's
    // bg-deep recipe so the card visually nests inside the live app.
    const bgDeep = darkenHex(bgHex, 0.95);

    return (
      <div
        ref={ref}
        data-testid="business-card-surface"
        style={{
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          backgroundImage: `linear-gradient(180deg, ${bgHex} 0%, ${bgDeep} 100%)`,
          borderRadius: 24,
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          padding: 20,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          fontFamily: '"Funnel Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          color: '#1F2937',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Header row — logo + shop name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {logoDataUrl ? (
            <img
              src={logoDataUrl}
              alt=""
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                objectFit: 'cover',
                background: 'rgba(255,255,255,0.4)',
              }}
            />
          ) : (
            <div
              aria-hidden
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: brandHex,
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              {profile.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div
              style={{
                fontFamily: '"Funnel Display", "Funnel Sans", system-ui, sans-serif',
                fontSize: 18,
                fontWeight: 600,
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {profile.name}
            </div>
            {profile.tagline ? (
              <div
                style={{
                  fontSize: 11,
                  color: brandHex,
                  fontWeight: 500,
                  lineHeight: 1.3,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {profile.tagline}
              </div>
            ) : null}
          </div>
        </div>

        {/* Contact lines — address, phone, email. Each line truncates
            with ellipsis so a long entry doesn't wreck the layout. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {lines.map((line) => (
            <div
              key={line}
              style={{
                fontSize: 11,
                color: '#4B5563',
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {line}
            </div>
          ))}
        </div>

        {/* Social row */}
        {socials.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {socials.map((entry) => (
              <span
                key={entry.label}
                style={{
                  fontSize: 10,
                  background: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(31,41,55,0.08)',
                  borderRadius: 8,
                  padding: '2px 8px',
                  color: '#4B5563',
                  whiteSpace: 'nowrap',
                }}
              >
                {entry.label}
              </span>
            ))}
          </div>
        ) : null}

        {/* QR code — placed bottom-right, with a discreet caption
            telling the merchant what it points at. */}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'end', gap: 8 }}>
          <div
            style={{
              fontSize: 9,
              color: '#6B7280',
              lineHeight: 1.3,
              flex: 1,
              minWidth: 0,
              alignSelf: 'flex-end',
              paddingBottom: 4,
            }}
          >
            scan to visit
            <br />
            our shop online
          </div>
          <div
            style={{
              width: 88,
              height: 88,
              background: '#FFFFFF',
              borderRadius: 10,
              padding: 4,
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}
            data-testid="business-card-qr"
            dangerouslySetInnerHTML={qrSvg ? { __html: qrSvg } : undefined}
          />
        </div>

        {/* Bottom accent bar — pulls the brand into a visual anchor at
            the foot of the card. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 6,
            background: brandHex,
          }}
        />
      </div>
    );
  },
);

// Collects address / phone / email into the line list shown on the
// card body. Order: address (single line, comma-joined) → phone /
// whatsapp → email. Null fields drop out.
function collectContactLines(profile: ShopProfile): string[] {
  const out: string[] = [];
  const addressParts = [profile.address_street, profile.address_city, profile.address_country]
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((s) => s.trim());
  if (addressParts.length > 0) out.push(addressParts.join(', '));
  if (profile.phone) out.push(profile.phone);
  if (profile.whatsapp && profile.whatsapp !== profile.phone) {
    out.push(`WhatsApp: ${profile.whatsapp}`);
  }
  if (profile.email) out.push(profile.email);
  if (profile.website) {
    const display = profile.website.replace(/^https?:\/\//i, '');
    out.push(display);
  }
  return out;
}

function collectSocialLines(profile: ShopProfile): Array<{ label: string; href: string | null }> {
  const out: Array<{ label: string; href: string | null }> = [];
  if (profile.instagram) {
    out.push({
      label: `📸 ${profile.instagram}`,
      href: `https://instagram.com/${profile.instagram.replace(/^@/, '')}`,
    });
  }
  if (profile.facebook) {
    out.push({
      label: `📘 ${profile.facebook}`,
      href: profile.facebook.startsWith('http')
        ? profile.facebook
        : `https://facebook.com/${profile.facebook}`,
    });
  }
  if (profile.tiktok) {
    out.push({
      label: `🎵 ${profile.tiktok}`,
      href: `https://tiktok.com/${profile.tiktok.startsWith('@') ? profile.tiktok : `@${profile.tiktok}`}`,
    });
  }
  if (profile.whatsapp) {
    const href = whatsappHref(profile.whatsapp);
    if (href !== null) out.push({ label: `💬 ${profile.whatsapp}`, href });
  }
  return out;
}

function buildCatalogueUrl(profile: ShopProfile): string {
  // Stable slug — uses the singleton id (always 'singleton' in v0.9
  // since the app is single-tenant per device). When the public
  // catalogue ships in v0.10 it'll resolve this slug to the merchant
  // record via the device-paired account.
  const slug = slugify(profile.name) || profile.id;
  return `https://inventar.hoodhood.ai/shop/${slug}`;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

function darkenHex(hex: string, factor: number): string {
  const parsed = parseHex(hex);
  if (parsed === null) return hex;
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n * factor)));
  const pad = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${pad(clamp(parsed.r))}${pad(clamp(parsed.g))}${pad(clamp(parsed.b))}`;
}

export { collectContactLines, collectSocialLines, buildCatalogueUrl, slugify };
