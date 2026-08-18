import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Layers, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, Panel, PriorityBadge, StatusChip, fmtH } from "@/components/wh/bits";
import { Shell } from "@/components/wh/shell";
import { pickRoute, pickWaves, scoreOrder } from "@/lib/wh/engine";
import { useWarehouse } from "@/lib/wh/store";
import type { OrderStatus } from "@/lib/wh/types";

export const Route = createFileRoute("/fulfillment")({
  head: () => ({
    meta: [
      { title: "Picking, Packing & Dispatch Board — Nexus WMS" },
      {
        name: "description",
        content:
          "Kanban floor board for picking waves, packing, quality check and dispatch with optimized pick routes per order.",
      },
      { property: "og:title", content: "Picking, Packing & Dispatch Board — Nexus WMS" },
      { property: "og:description", content: "Run the floor: waves, pick routes, QC and dispatch in one board." },
    ],
  }),
  component: FulfillmentPage,
});

const COLUMNS: { stage: OrderStatus; title: string; hint: string }[] = [
  { stage: "allocated", title: "Ready to pick", hint: "Stock committed" },
  { stage: "picking", title: "Picking", hint: "4 pickers on floor" },
  { stage: "packing", title: "Packing", hint: "3 stations" },
  { stage: "qc", title: "Quality check", hint: "1 QC lane" },
  { stage: "dispatched", title: "Dispatched", hint: "Handed to carrier" },
];

const PICKERS = ["Asha", "Dev", "Mina", "Rui"];

function FulfillmentPage() {
  const { state, advance, assign, reportException } = useWarehouse();
  const waves = pickWaves(state);

  return (
    <Shell>
      <div className="mb-5">
        <p className="label-caps">Floor operations</p>
        <h1 className="text-3xl font-bold">Pick · Pack · QC · Dispatch</h1>
      </div>

      <Panel className="mb-5" title="Suggested picking waves" subtitle="Orders grouped by travel zone so one walk serves several orders">
        {waves.length === 0 ? (
          <Empty>No allocated work — run the allocation engine to release orders.</Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-3">
            {waves.map((w) => (
              <li key={w.zone} className="rounded-sm border border-border bg-surface-2/60 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Layers className="size-4 text-accent" /> Zone {w.zone}
                </p>
                <p className="num mt-1 text-xs text-muted-foreground">
                  {w.orders.length} orders · {w.units} units
                </p>
                <p className="num mt-1 text-xs">{w.orders.map((o) => o.id).join(" · ")}</p>
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => {
                    w.orders.filter((o) => o.status === "allocated").forEach((o, i) => {
                      assign(o.id, PICKERS[i % PICKERS.length]!);
                      advance(o.id);
                    });
                    toast.success(`Wave released for zone ${w.zone}`, {
                      description: "Pickers assigned round-robin, routes sorted by aisle.",
                    });
                  }}
                >
                  Release wave
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const orders = state.orders
            .filter((o) => o.status === col.stage)
            .map((o) => ({ o, s: scoreOrder(o, state.clock) }))
            .sort((a, b) => b.s.score - a.s.score);
          return (
            <div key={col.stage} className="panel flex flex-col">
              <header className="border-b border-border px-3 py-2">
                <p className="text-sm font-semibold">{col.title}</p>
                <p className="num text-[11px] text-muted-foreground">
                  {orders.length} · {col.hint}
                </p>
              </header>
              <div className="flex-1 space-y-2 p-2">
                {orders.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Empty</p>}
                {orders.map(({ o, s }) => {
                  const route = pickRoute(o, state.products);
                  return (
                    <article key={o.id} className="rounded-sm border border-border bg-surface-2/70 p-2.5">
                      <div className="flex items-center justify-between gap-1">
                        <Link to="/orders/$orderId" params={{ orderId: o.id }} className="num text-sm font-semibold hover:underline">
                          {o.id}
                        </Link>
                        <PriorityBadge score={s.score} band={s.band} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{o.customer}</p>
                      <p className={`num text-[11px] ${s.hoursToSla <= 0 ? "text-destructive" : s.hoursToSla < 6 ? "text-warning" : "text-muted-foreground"}`}>
                        {fmtH(s.hoursToSla)}
                      </p>
                      {col.stage === "picking" && (
                        <p className="num mt-1 text-[11px] text-accent">
                          {route.stops.length} stops · {route.metres}m · ~{route.etaMin}min
                        </p>
                      )}
                      {o.assignedTo && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <User className="size-3" /> {o.assignedTo}
                        </p>
                      )}
                      {col.stage !== "dispatched" && (
                        <div className="mt-2 flex gap-1">
                          <Button size="sm" className="h-7 flex-1 px-2 text-xs" onClick={() => advance(o.id)}>
                            Next <ArrowRight className="size-3" />
                          </Button>
                          {col.stage === "qc" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-destructive"
                              onClick={() => {
                                reportException({ orderId: o.id, sku: o.lines[0]!.sku, qty: 1, kind: "qc_fail" });
                                toast.error("QC fail logged", { description: "Resolution options ready in Exceptions." });
                              }}
                            >
                              Fail
                            </Button>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
