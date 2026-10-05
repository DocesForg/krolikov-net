interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_THEME?: string;
  readonly VITE_LRCLIB_API_URL?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_GEMINI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
