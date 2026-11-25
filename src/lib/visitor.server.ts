import { getRequest } from "@tanstack/react-start/server";

/** A hash of the visitor's IP address, used as a daily allowance key. The IP itself is never stored. */
export async function visitorKey(): Promise<string> {
  const headers = getRequest()?.headers;
  const ip = headers?.get("cf-connecting-ip") ?? headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`logosphere-demo:${ip}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
