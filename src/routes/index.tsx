import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Play, Mic, Sparkles, Headphones, QrCode, Captions, Languages, Settings2, Radio, Users, Building2, Cpu, Sparkle } from "lucide-react";
import hero from "@/assets/hero-illustration.jpg";
import { LiveDemo } from "@/components/landing/LiveDemo";
import { TARGET_LANGUAGES, STATUS_LABEL } from "@/lib/languages";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Logosphere — Real-time multilingual church interpretation" },
      { name: "description", content: "One voice, every language. Live AI sermon interpretation in French, Spanish, Portuguese, Igbo, Yoruba and Hausa — straight to congregants' phones." },
      { property: "og:title", content: "Logosphere — One Voice. Every Language." },
      { property: "og:description", content: "Live AI sermon interpretation delivered to every congregant's smartphone and headphones." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Logo() {
  return (
    <a href="/" className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg border-[1.5px] border-foreground">
        <Radio className="size-4" />
      </span>
      <span className="font-display text-xl tracking-tight">Logosphere</span>
    </a>
  );
}

const btn = "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-medium transition";
const btnPrimary = cn(btn, "bg-primary text-primary-foreground hover:opacity-90");
const btnOutline = cn(btn, "border bg-card hover:border-foreground/40");
const eyebrow = "font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase";

const FEATURES = [
  { icon: Sparkles, t: "Real-time speech interpretation", d: "Streaming AI engines interpret as the preacher speaks." },
  { icon: Languages, t: "Multiple language channels", d: "Each language runs as its own independent audio channel." },
  { icon: QrCode, t: "QR-code access", d: "Members scan once — no app download, no account." },
  { icon: Headphones, t: "Individual listening", d: "Every listener picks a language on their own phone." },
  { icon: Captions, t: "Live captions", d: "Optional on-screen text alongside the translated audio." },
  { icon: Mic, t: "Source-language selection", d: "Preach in English, French, Yoruba or any supported source." },
  { icon: Settings2, t: "Administrator controls", d: "Start, pause and stop sessions; enable channels per service." },
  { icon: Users, t: "Listener monitoring", d: "See how many people are on each language in real time." },
  { icon: Building2, t: "Multi-church support", d: "One platform for parishes, conferences and networks." },
  { icon: Cpu, t: "Expandable AI engines", d: "Swap models and GPU providers without touching the app." },
];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">How It Works</a>
            <a href="#languages" className="hover:text-foreground">Languages</a>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#churches" className="hover:text-foreground">For Churches</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/auth" className="hidden rounded-full border px-4 py-2 text-sm font-medium sm:inline-flex">Sign In</Link>
            <Link to="/auth" search={{ mode: "up" }} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <Sparkle className="size-3.5" /> Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-glow" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-5 pt-12 pb-20 text-center">
          <img src={hero} alt="A preacher speaking into a microphone while congregants listen through headphones on their phones" width={1600} height={720} className="mx-auto w-full max-w-4xl mix-blend-multiply animate-rise" />
          <span className="mt-2 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="size-3" /> Real-time sermon interpretation
          </span>
          <h1 className="mt-6 font-display text-5xl leading-[1.02] tracking-tight sm:text-7xl md:text-[5.5rem] animate-rise">
            One Voice.<br />Every Language.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Every member deserves to understand the message. Bring real-time multilingual interpretation to your congregation, directly through their smartphones.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a href="#cta" className={btnPrimary}>Start a Live Session <ArrowRight className="size-4" /></a>
            <a href="#how" className={btnOutline}><Play className="size-4" /> See How It Works</a>
          </div>
        </div>
      </section>

      {/* Demo */}
      <section className="mx-auto max-w-5xl px-5 pb-28">
        <div className="mb-8 text-center">
          <p className={eyebrow}>Live interpretation demonstration</p>
          <h2 className="mt-3 font-display text-3xl sm:text-4xl">One microphone. Six channels.</h2>
        </div>
        <LiveDemo />
      </section>

      {/* How */}
      <section id="how" className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <p className={eyebrow}>How it works</p>
          <h2 className="mt-3 max-w-xl font-display text-4xl sm:text-5xl">From pulpit to pew, in three steps.</h2>
          <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border bg-border md:grid-cols-3">
            {[
              ["01", "Speak", "The preacher speaks naturally into the church microphone.", Mic],
              ["02", "Interpret", "AI interpretation engines process the speech and generate translated audio.", Sparkles],
              ["03", "Listen", "Congregants scan a QR code, choose a language and listen through headphones.", Headphones],
            ].map(([n, t, d, Icon]: any) => (
              <div key={n} className="bg-card p-8">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-muted-foreground">{n}</span>
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-12 font-display text-3xl">{t}</h3>
                <p className="mt-3 text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Languages */}
      <section id="languages" className="mx-auto max-w-6xl px-5 py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className={eyebrow}>Language support</p>
            <h2 className="mt-3 font-display text-4xl sm:text-5xl">Six languages, honestly labelled.</h2>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Nigerian-language speech engines are still in research. Each channel opens only once its AI engine is verified.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TARGET_LANGUAGES.map((l) => (
            <div key={l.code} className="group rounded-3xl border bg-card p-6 transition hover:shadow-card">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground uppercase">{l.region} · {l.code}</span>
                <span className="flex items-center gap-1.5 text-xs">
                  <span className={cn("size-1.5 rounded-full", l.status === "under_development" ? "bg-muted-foreground/40" : "bg-warning")} />
                  {STATUS_LABEL[l.status]}
                </span>
              </div>
              <p className="mt-10 font-display text-4xl">{l.native}</p>
              <p className="mt-1 text-muted-foreground">{l.name}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t bg-card">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <p className={eyebrow}>Features</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl sm:text-5xl">Built for Sunday morning, ready for the conference hall.</h2>
          <div className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
            {FEATURES.map(({ icon: Icon, t, d }) => (
              <div key={t}>
                <Icon className="size-5" />
                <h3 className="mt-4 font-medium">{t}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Churches */}
      <section id="churches" className="mx-auto grid max-w-6xl gap-12 px-5 py-24 md:grid-cols-2 md:items-center">
        <div>
          <p className={eyebrow}>For churches</p>
          <h2 className="mt-3 font-display text-4xl sm:text-5xl">No booths. No interpreters' schedule. No app to install.</h2>
          <p className="mt-5 text-muted-foreground">
            Visitors, diaspora members and multilingual families hear the same sermon at the same moment. Your media team starts a session, prints the QR code, and the congregation does the rest.
          </p>
        </div>
        <div className="rounded-3xl border bg-card p-6 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className={eyebrow}>Sunday Service</p>
              <p className="mt-1 font-display text-2xl">Grace Chapel · Lagos</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">Sample</span>
          </div>
          <div className="mt-6 space-y-2">
            {TARGET_LANGUAGES.map((l) => (
              <div key={l.code} className="flex items-center justify-between rounded-xl border bg-background px-4 py-3 text-sm">
                <span>{l.name}</span>
                <span className="text-xs text-muted-foreground">{STATUS_LABEL[l.status]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="cta" className="px-5 pb-24">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-primary px-6 py-20 text-center text-primary-foreground">
          <h2 className="mx-auto max-w-3xl font-display text-4xl leading-tight sm:text-6xl">Every Voice. Every Language. Every Congregation.</h2>
          <Link to="/dashboard" className={cn(btn, "mt-10 bg-primary-foreground text-primary hover:opacity-90")}>
            Start Your Interpretation Session <ArrowRight className="size-4" />
          </Link>
          <p className="mt-4 text-sm opacity-60">Register your church in minutes.</p>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 text-sm md:grid-cols-5">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-muted-foreground">Real-time multilingual interpretation for churches, conferences and gatherings.</p>
          </div>
          {[
            ["Product", ["Features", "How It Works", "For Churches"]],
            ["Languages", TARGET_LANGUAGES.map((l) => l.name)],
            ["Company", ["Documentation", "Privacy", "Terms", "Contact"]],
          ].map(([h, items]: any) => (
            <div key={h}>
              <p className="font-medium">{h}</p>
              <ul className="mt-3 space-y-2 text-muted-foreground">{items.map((i: string) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="border-t py-6 text-center text-xs text-muted-foreground">© 2026 Logosphere · Built for the AI for Church Hackathon</p>
      </footer>
    </div>
  );
}
