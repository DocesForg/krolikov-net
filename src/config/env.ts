export const env = {
  appName: import.meta.env.VITE_APP_NAME || "Krolikov",
  theme: import.meta.env.VITE_THEME || "dark",
  auddApiUrl: import.meta.env.VITE_AUDD_API_URL || "https://api.audd.io/",
  auddApiToken: import.meta.env.VITE_AUDD_API_TOKEN || "",
  lrclibApiUrl: import.meta.env.VITE_LRCLIB_API_URL || "https://lrclib.net/api/",
  lastfmApiUrl: import.meta.env.VITE_LASTFM_API_URL || "https://ws.audioscrobbler.com/2.0/",
  lastfmApiKey: import.meta.env.VITE_LASTFM_API_KEY || "",
} as const;