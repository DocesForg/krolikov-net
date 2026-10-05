interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_THEME?: string;
  readonly VITE_LRCLIB_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
