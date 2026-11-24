import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Search = { redirect?: string; mode?: "in" | "up" };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const r = s["redirect"];
    const m = s["mode"];
    return {
      ...(typeof r === "string" && r.startsWith("/") && !r.startsWith("//") ? { redirect: r } : {}),
      ...(m === "up" ? { mode: "up" as const } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Sign in — Logosphere" },
      { name: "description", content: "Sign in or create a Logosphere account to run live multilingual interpretation for your church." },
      { property: "og:title", content: "Sign in — Logosphere" },
      { property: "og:description", content: "Access your church's Logosphere interpretation dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

const GoogleG = () => (
  <svg aria-hidden="true" width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
);

function AuthPage() {
  const { redirect, mode: startMode } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">(startMode ?? "in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const dest = redirect ?? "/dashboard";

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) navigate({ to: dest, replace: true }); });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => { if (e === "SIGNED_IN" && s) navigate({ to: dest, replace: true }); });
    return () => sub.subscription.unsubscribe();
  }, [dest, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "up") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin + "/auth", data: { display_name: name } },
        });
        if (error) throw error;
        setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally { setBusy(false); }
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/auth" } });
    if (error) toast.error(error.message);
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-5">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-10 flex items-center justify-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg border-[1.5px] border-foreground"><Radio className="size-4" /></span>
          <span className="font-display text-xl tracking-tight">Logosphere</span>
        </Link>
        <div className="rounded-3xl border bg-card p-7 shadow-card">
          {sent ? (
            <div className="text-center">
              <h1 className="font-display text-2xl">Check your email</h1>
              <p className="mt-3 text-sm text-muted-foreground">We sent a confirmation link to {email}. Open it to finish creating your account.</p>
            </div>
          ) : (
            <>
              <h1 className="font-display text-3xl">{mode === "in" ? "Welcome back" : "Create account"}</h1>
              <button onClick={google} type="button" className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-full border border-[#747775] bg-[#FFFFFF] py-2.5 text-sm font-medium text-[#1F1F1F]">
                <GoogleG /> Continue with Google
              </button>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
              <form onSubmit={submit} className="space-y-4">
                {mode === "up" && (
                  <div className="space-y-1.5"><Label htmlFor="name">Your name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
                )}
                <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div className="space-y-1.5"><Label htmlFor="pw">Password</Label><Input id="pw" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
                <button disabled={busy} className="w-full rounded-full bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                  {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
                </button>
              </form>
              <p className="mt-5 text-center text-sm text-muted-foreground">
                {mode === "in" ? "New to Logosphere?" : "Already have an account?"}{" "}
                <button type="button" className="font-medium text-foreground underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
                  {mode === "in" ? "Create an account" : "Sign in"}
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
