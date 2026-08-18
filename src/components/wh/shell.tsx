import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardList,
  Clock,
  PackageCheck,
  RotateCcw,
  Warehouse,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useWarehouse } from "@/lib/wh/store";

const NAV = [
  { to: "/", label: "Control Tower", icon: Activity },
  { to: "/orders", label: "Orders", icon: ClipboardList },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/fulfillment", label: "Fulfillment", icon: PackageCheck },
  { to: "/exceptions", label: "Exceptions", icon: AlertTriangle },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { state, tick, reset } = useWarehouse();
  const openExc = state.exceptions.filter((e) => e.status === "open").length;
  const clock = new Date(state.clock).toISOString().slice(11, 16);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-4 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-sm bg-primary text-primary-foreground">
              <Warehouse className="size-4" />
            </span>
            <span className="font-display text-lg font-bold uppercase tracking-[0.18em]">Nexus WMS</span>
          </Link>

          <nav className="flex flex-1 flex-wrap items-center gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                activeProps={{ className: "bg-primary/15 text-primary" }}
                className="relative inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Icon className="size-4" />
                {label}
                {to === "/exceptions" && openExc > 0 && (
                  <span className="num ml-0.5 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                    {openExc}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="num flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground">
              <Clock className="size-3.5" /> {clock} UTC · shift A
            </span>
            <Button size="sm" variant="secondary" onClick={() => tick(2)} title="Advance simulated shift clock">
              +2h
            </Button>
            <Button size="sm" variant="ghost" onClick={reset} title="Reset the simulated shift">
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>
    </div>
  );
}
