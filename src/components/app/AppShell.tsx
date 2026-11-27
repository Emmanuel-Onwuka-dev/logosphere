import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; hash?: string };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/dashboard", label: "Live Interpretation", hash: "live" },
  { to: "/recordings", label: "Recorded Sermons" },
  { to: "/library", label: "Sermon Library" },
  { to: "/outreach", label: "Evangelism & Outreach" },
  { to: "/languages", label: "Language Settings" },
  { to: "/activity", label: "Usage & Activity" },
  { to: "/profile", label: "Profile" },
  { to: "/organisation", label: "Organisation" },
];

/** Shared header and navigation for every signed-in page. Works on desktop and mobile. */
export function AppShell({ children, active }: { children: ReactNode; active: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const { data: roles = [] } = useQuery({
    queryKey: ["my-roles"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [] as string[];
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return (data ?? []).map((r) => r.role as string);
    },
  });
  const isPlatformAdmin = roles.includes("platform_admin");

  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const items = [...NAV, ...(isPlatformAdmin ? [{ to: "/control", label: "Control Centre" }, { to: "/playground", label: "Model Playground" }] : [])];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <img src="/logo-mark.png" alt="" className="size-8" />
            <span className="font-display text-xl tracking-tight">Logosphere</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {items.map((item) => item.hash ? (
              <a key={item.label} href={`${item.to}#${item.hash}`} className={cn("rounded-full px-3 py-2 text-sm transition hover:bg-secondary", active === item.label && "bg-secondary font-medium")}>{item.label}</a>
            ) : (
              <Link key={item.label} to={item.to} className={cn("rounded-full px-3 py-2 text-sm transition hover:bg-secondary", active === item.label && "bg-secondary font-medium")}>{item.label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={signOut} className="hidden items-center gap-1.5 rounded-full border px-4 py-2 text-sm sm:inline-flex"><LogOut className="size-3.5" /> Sign out</button>
            <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" className="grid size-10 place-items-center rounded-full border lg:hidden" aria-label={open ? "Close menu" : "Open menu"}>
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label="Main mobile" className="border-t px-5 py-3 lg:hidden">
            <ul className="grid gap-1">
              {items.map((item) => (
                <li key={item.label}>
                  {item.hash ? (
                    <a href={`${item.to}#${item.hash}`} onClick={() => setOpen(false)} className={cn("block rounded-xl px-3 py-3 text-sm hover:bg-secondary", active === item.label && "bg-secondary font-medium")}>{item.label}</a>
                  ) : (
                    <Link to={item.to} onClick={() => setOpen(false)} className={cn("block rounded-xl px-3 py-3 text-sm hover:bg-secondary", active === item.label && "bg-secondary font-medium")}>{item.label}</Link>
                  )}
                </li>
              ))}
              <li>
                <button onClick={signOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm hover:bg-secondary"><LogOut className="size-4" /> Sign out</button>
              </li>
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>
    </div>
  );
}
