import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Play, Sparkles, TrendingDown, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Bar, Empty, Panel, PriorityBadge, Stat, StatusChip, fmtH } from "@/components/wh/bits";
import { Shell } from "@/components/wh/shell";
import { bottlenecks, planAllocation, reorderPlan, scoreOrder, slaRisk, stageStats } from "@/lib/wh/engine";
import { useWarehouse } from "@/lib/wh/store";
import { available, stockState } from "@/lib/wh/types";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Control Tower — Nexus WMS" },
      {
        name: "description",
        content:
          "Live warehouse control tower: SLA risk, allocation decisions, bottlenecks and stock alerts in one screen.",
      },
      { property: "og:title", content: "Control Tower — Nexus WMS" },
      {
        property: "og:description",
        content: "Live warehouse control tower with allocation and exception decision support.",
      },
    ],
  }),
  component: ControlTower,
});

function ControlTower() {
  const { state, runAllocation, advance } = useWarehouse();
  const plan = planAllocation(state);
  const risks = slaRisk(state);
  const necks = bottlenecks(state);
  const reorders = reorderPlan(state);
  const stages = stageStats(state);

  const openOrders = state.orders.filter((o) => !["dispatched", "cancelled"].includes(o.status));
  const dispatched = state.orders.filter((o) => o.status === "dispatched").length;
  const openExc = state.exceptions.filter((e) => e.status === "open");
  const outOfStock = state.products.filter((p) => stockState(p) === "out").length;
  const unitsReserved = state.products.reduce((s, p) => s + p.reserved, 0);

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Operations control tower</p>
          <h1 className="text-3xl font-bold">Today's decisions, not just today's data</h1>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              runAllocation();
              toast.success("Allocation engine executed", { description: plan.summary });
            }}
          >
            <Play className="size-4" /> Run allocation engine
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/fulfillment">Open floor board <ArrowRight className="size-4" /></Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Open orders" value={openOrders.length} hint={`${dispatched} dispatched today`} />
        <Stat
          label="SLA at risk"
          value={risks.length}
          tone={risks.length ? "bad" : "good"}
          hint="< 6h to promised time"
        />
        <Stat label="Open exceptions" value={openExc.length} tone={openExc.length ? "warn" : "good"} hint="Awaiting a decision" />
        <Stat label="Out of stock SKUs" value={outOfStock} tone={outOfStock ? "bad" : "good"} hint={`${reorders.length} reorder suggestions`} />
        <Stat label="Units reserved" value={unitsReserved} tone="info" hint="Soft-allocated to open orders" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Recommended decisions"
          subtitle={plan.summary}
          action={
            <Button size="sm" onClick={() => runAllocation()}>
              Apply all
            </Button>
          }
        >
          {plan.actions.length === 0 ? (
            <Empty>No pending allocation decisions — every open line is committed.</Empty>
          ) : (
            <ul className="space-y-2">
              {plan.actions.slice(0, 7).map((a, i) => (
                <li key={i} className="rounded-sm border border-border bg-surface-2/60 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                        a.type === "full"
                          ? "bg-success/15 text-success"
                          : a.type === "partial"
                            ? "bg-warning/15 text-warning"
                            : a.type === "reallocate"
                              ? "bg-accent/15 text-accent"
                              : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {a.type === "reallocate" ? "re-allocate" : a.type}
                    </span>
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: a.orderId }}
                      className="num font-semibold text-foreground underline-offset-4 hover:underline"
                    >
                      {a.orderId}
                    </Link>
                    <span className="num text-muted-foreground">{a.sku}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.rationale}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="SLA countdown" subtitle="Highest urgency first">
          {risks.length === 0 ? (
            <Empty>All open orders have comfortable slack.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {risks.slice(0, 6).map(({ order, s }) => (
                <li key={order.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <PriorityBadge score={s.score} band={s.band} />
                      <Link
                        to="/orders/$orderId"
                        params={{ orderId: order.id }}
                        className="num truncate text-sm font-semibold hover:underline"
                      >
                        {order.id}
                      </Link>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{order.customer}</p>
                  </div>
                  <div className="text-right">
                    <p className={`num text-sm font-semibold ${s.hoursToSla <= 0 ? "text-destructive" : "text-warning"}`}>
                      {fmtH(s.hoursToSla)}
                    </p>
                    <StatusChip status={order.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel title="Stage load" subtitle="Work-in-progress vs shift capacity">
          <ul className="space-y-3">
            {stages
              .filter((s) => s.stage !== "dispatched")
              .map((s) => (
                <li key={s.stage}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="uppercase tracking-wider text-muted-foreground">{s.stage.replace("_", " ")}</span>
                    <span className="num">
                      {s.count}
                      {s.cap ? `/${s.cap}` : ""} · {s.dwell}h dwell
                    </span>
                  </div>
                  <Bar pct={s.cap ? (s.count / s.cap) * 100 : s.count * 12} tone={s.load >= 100 ? "bad" : s.load >= 70 ? "warn" : "primary"} />
                </li>
              ))}
          </ul>
        </Panel>

        <Panel title="Bottlenecks & fixes" subtitle="Detected from dwell time and capacity">
          {necks.length === 0 ? (
            <Empty>Flow is balanced — no stage is constrained right now.</Empty>
          ) : (
            <ul className="space-y-3">
              {necks.map((b) => (
                <li key={b.stage} className="rounded-sm border border-border bg-surface-2/60 p-3">
                  <p className={`flex items-center gap-1.5 text-sm font-semibold ${b.severity === "critical" ? "text-destructive" : "text-warning"}`}>
                    <AlertTriangle className="size-4" /> {b.stage.replace("_", " ")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{b.message}</p>
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-primary">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0" /> {b.action}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Replenishment signals" subtitle="Reorder before it becomes a stockout">
          {reorders.length === 0 ? (
            <Empty>Every SKU is above its reorder point.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {reorders.slice(0, 5).map((r) => (
                <li key={r.sku} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.reason}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="num text-sm font-semibold text-primary">+{r.qty}</p>
                    <p className={`text-[11px] uppercase tracking-wider ${r.urgency === "now" ? "text-destructive" : "text-muted-foreground"}`}>
                      {r.urgency}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" size="sm" className="mt-3 w-full" asChild>
            <Link to="/inventory">
              <TrendingDown className="size-4" /> Inventory & receiving
            </Link>
          </Button>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Ready to move" subtitle="One click advances the fulfillment stage">
          {openOrders.filter((o) => o.status !== "new" && o.status !== "awaiting_stock").length === 0 ? (
            <Empty>Nothing on the floor yet — allocate stock to release work.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {openOrders
                .filter((o) => o.status !== "new" && o.status !== "awaiting_stock")
                .slice(0, 6)
                .map((o) => {
                  const s = scoreOrder(o, state.clock);
                  return (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="flex items-center gap-2">
                        <PriorityBadge score={s.score} band={s.band} />
                        <Link to="/orders/$orderId" params={{ orderId: o.id }} className="num text-sm font-semibold hover:underline">
                          {o.id}
                        </Link>
                        <StatusChip status={o.status} />
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => advance(o.id)}>
                        Advance <ArrowRight className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
            </ul>
          )}
        </Panel>

        <Panel title="Decision log" subtitle="Every automated and manual call, with its reasoning">
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {state.log.slice(0, 14).map((l) => (
              <li key={l.id} className="border-l-2 border-border pl-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className={`num text-[11px] uppercase ${
                      l.kind === "decision" ? "text-primary" : l.kind === "exception" ? "text-destructive" : "text-accent"
                    }`}
                  >
                    {l.kind}
                  </span>
                  {l.title}
                </p>
                <p className="text-xs text-muted-foreground">{l.detail}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Truck className="size-3.5" /> Simulated warehouse · {state.products.length} SKUs ·{" "}
        {state.products.reduce((s, p) => s + available(p), 0)} allocatable units on hand
      </p>
    </Shell>
  );
}
