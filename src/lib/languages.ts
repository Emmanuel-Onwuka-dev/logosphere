export type LanguageStatus =
  | "available" | "ready" | "testing" | "connecting" | "under_development" | "unavailable" | "paused";

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
  { code: "pt", name: "Portuguese", native: "Português", region: "International", pipeline: "direct", status: "under_development" },
  { code: "ig", name: "Igbo", native: "Asụsụ Igbo", region: "Nigerian", pipeline: "cascaded", status: "paused" },
  { code: "yo", name: "Yoruba", native: "Èdè Yorùbá", region: "Nigerian", pipeline: "cascaded", status: "paused" },
  { code: "ha", name: "Hausa", native: "Harshen Hausa", region: "Nigerian", pipeline: "cascaded", status: "paused" },
];

export const SOURCE_LANGUAGES = [
  { code: "en", name: "English" },
];

/** Only these have been tested end to end. Everything else is shown as coming soon and cannot be switched on. */
export const TESTED_LANGUAGE_CODES: readonly string[] = ["fr", "es"];
export const isComingSoon = (code: string) => !TESTED_LANGUAGE_CODES.includes(code);

export const ACTIVE_TARGET_LANGUAGES = TARGET_LANGUAGES.filter((l) => l.status !== "paused");

export const STATUS_LABEL: Record<LanguageStatus, string> = {
  available: "Available",
  ready: "Ready",
  testing: "Testing",
  connecting: "Connecting",
  under_development: "Coming soon",
  unavailable: "Unavailable",
  paused: "Coming soon",
};
