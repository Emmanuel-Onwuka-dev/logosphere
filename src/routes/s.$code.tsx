import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio } from "lucide-react";

export const Route = createFileRoute("/s/$code")({
  head: () => ({
    meta: [
      { title: "Join live interpretation — Logosphere" },
      { name: "description", content: "Listen to this church service in your language on Logosphere." },
      { property: "og:title", content: "Join live interpretation — Logosphere" },
      { property: "og:description", content: "Pick your language and listen live." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { code } = Route.useParams();
  return (
    <div className="grid min-h-screen place-items-center bg-background px-5 text-center">
      <div className="max-w-sm">
        <Link to="/" className="mb-8 inline-flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg border-[1.5px] border-foreground"><Radio className="size-4" /></span>
          <span className="font-display text-xl">Logosphere</span>
        </Link>
        <p className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Session {code}</p>
        <h1 className="mt-3 font-display text-3xl">Listening page coming soon</h1>
        <p className="mt-3 text-sm text-muted-foreground">The congregant listening experience is the next phase. This link will work once it's built.</p>
      </div>
    </div>
  );
}
