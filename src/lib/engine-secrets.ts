/** These are secret names, never credential values. */
export const SECRET_PREFIX = "ENGINE_";
export function isEngineSecretName(ref: string | null | undefined) {
  return !!ref && (/^ENGINE_[A-Z0-9_]+$/.test(ref) || ref === "DEEPGRAM_API_KEY");
}
export function isDeepgramEndpoint(url: string | null | undefined) {
  if (!url) return false;
  try { return new URL(url).hostname === "api.deepgram.com"; } catch { return false; }
}