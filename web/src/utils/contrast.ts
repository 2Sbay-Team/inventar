export function normaliseHex(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  const raw = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;

  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const expanded = raw
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }

  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toUpperCase()}`;
  }

  return null;
}

export function getLuminance(hex: string): number {
  const safeHex = normaliseHex(hex) ?? '#000000';
  const rgb = safeHex
    .replace('#', '')
    .match(/.{1,2}/g)
    ?.map((chunk) => parseInt(chunk, 16)) ?? [0, 0, 0];

  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getContrastRatio(backgroundHex: string, foregroundHex: string): number {
  const background = getLuminance(backgroundHex);
  const foreground = getLuminance(foregroundHex);

  return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
}

export function isWCAGReadable(
  backgroundHex: string,
  foregroundHex: string,
  level: 'AA' | 'AAA' = 'AA',
): boolean {
  const ratio = getContrastRatio(backgroundHex, foregroundHex);
  return level === 'AAA' ? ratio >= 7 : ratio >= 4.5;
}

export function getReadableTextColor(backgroundHex: string): '#FFFFFF' | '#111827' {
  const whiteRatio = getContrastRatio(backgroundHex, '#FFFFFF');
  const darkRatio = getContrastRatio(backgroundHex, '#111827');

  return whiteRatio >= darkRatio ? '#FFFFFF' : '#111827';
}

// QR codes need strong contrast against the white label background. If a
// merchant picks a very pale brand colour, keep the QR scannable by falling
// back to black. This protects printed labels and phone-camera scanning.
export function getSafeQrColor(brandColor: string | null | undefined): string {
  const normalised = normaliseHex(brandColor);
  if (!normalised) return '#000000';

  return getContrastRatio('#FFFFFF', normalised) >= 4.5 ? normalised : '#000000';
}

export function adjustBrightness(hex: string, factor: number): string {
  const normalised = normaliseHex(hex);
  if (!normalised) return hex;

  const rgb = normalised
    .replace('#', '')
    .match(/.{1,2}/g)
    ?.map((chunk) => parseInt(chunk, 16)) ?? [0, 0, 0];

  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value * factor)));
  const pad = (value: number) => value.toString(16).padStart(2, '0').toUpperCase();

  return `#${pad(clamp(rgb[0]))}${pad(clamp(rgb[1]))}${pad(clamp(rgb[2]))}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalised = normaliseHex(hex);
  if (!normalised) return `rgba(0, 0, 0, ${alpha})`;

  const rgb = normalised
    .replace('#', '')
    .match(/.{1,2}/g)
    ?.map((chunk) => parseInt(chunk, 16)) ?? [0, 0, 0];

  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${safeAlpha})`;
}
