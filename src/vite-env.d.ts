/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_THEME?: "dark" | "light";
  readonly VITE_AUDD_API_URL?: string;
  readonly VITE_AUDD_API_TOKEN?: string;
  readonly VITE_LRCLIB_API_URL?: string;
  readonly VITE_LASTFM_API_URL?: string;
  readonly VITE_LASTFM_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}