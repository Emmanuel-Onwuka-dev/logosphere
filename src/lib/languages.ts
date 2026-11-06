export type LanguageStatus =
  | "available" | "ready" | "testing" | "connecting" | "under_development" | "unavailable";

export interface TargetLanguage {
  code: string;
  name: string;
  native: string;
  region: "International" | "Nigerian";
  pipeline: "direct" | "cascaded";
  status: LanguageStatus;
}

/** Status reflects real engine readiness. No engine is connected yet, so none are "available". */
export const TARGET_LANGUAGES: TargetLanguage[] = [
  { code: "fr", name: "French", native: "Français", region: "International", pipeline: "direct", status: "testing" },
  { code: "es", name: "Spanish", native: "Español", region: "International", pipeline: "direct", status: "testing" },
  { code: "pt", name: "Portuguese", native: "Português", region: "International", pipeline: "direct", status: "testing" },
  { code: "ig", name: "Igbo", native: "Asụsụ Igbo", region: "Nigerian", pipeline: "cascaded", status: "under_development" },
  { code: "yo", name: "Yoruba", native: "Èdè Yorùbá", region: "Nigerian", pipeline: "cascaded", status: "under_development" },
  { code: "ha", name: "Hausa", native: "Harshen Hausa", region: "Nigerian", pipeline: "cascaded", status: "under_development" },
];

export const SOURCE_LANGUAGES = [
  { code: "en", name: "English" },
  ...TARGET_LANGUAGES.map(({ code, name }) => ({ code, name })),
];

export const STATUS_LABEL: Record<LanguageStatus, string> = {
  available: "Available",
  ready: "Ready",
  testing: "Testing",
  connecting: "Connecting",
  under_development: "Under development",
  unavailable: "Unavailable",
};
