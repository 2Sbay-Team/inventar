import { db } from '../db/db';
import { useLive } from './use-live';
import { getMeta, META_KEYS } from '../repos/meta';
import { isPlausibleScannableCode, isValidStrictEan13 } from '../utils/ean';

// v0.5 ADR-018 (gap-fix opt-in): /receive and /sell call this hook to
// pick the active barcode validator. Default is the loose
// 12-or-13-digit check; the merchant can flip a Settings toggle to
// require a real EAN-13 with valid checksum (UPC-A and in-house codes
// fail under strict).

export type EanValidator = (input: string) => boolean;

export function useEanValidator(): EanValidator {
  const strict = useLive<boolean>(
    async () => Boolean(await getMeta<boolean>(db, META_KEYS.ean_strict)),
    [],
    false,
  );
  return strict ? isValidStrictEan13 : isPlausibleScannableCode;
}
