export const env = {
  appName: import.meta.env.VITE_APP_NAME || "Krolikov",
  theme: import.meta.env.VITE_THEME || "dark",
  lrclibApiUrl: import.meta.env.VITE_LRCLIB_API_URL || "https://lrclib.net/api/",
  geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || "",
  geminiModel: import.meta.env.VITE_GEMINI_MODEL || "gemini-3.6-flash",
} as const;
