/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// arabic-reshaper is a UMD module without bundled types. We only call
// convertArabic so a minimal shim covers our usage.
declare module 'arabic-reshaper' {
  export function convertArabic(text: string): string;
  const _default: { convertArabic: (text: string) => string };
  export default _default;
}
