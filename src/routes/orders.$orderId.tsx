import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, PackageX, Route as RouteIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Bar, Empty, Panel, PriorityBadge, Stat, StatusChip, fmtH } from "@/components/wh/bits";
import { Shell } from "@/components/wh/shell";
import { pickRoute, planAllocation, scoreOrder } from "@/lib/wh/engine";
import { useWarehouse } from "@/lib/wh/store";
import { STAGE_FLOW, available } from "@/lib/wh/types";

export const Route = createFileRoute("/orders/$orderId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.orderId} — Order detail · Nexus WMS` },
      {
        name: "description",
        content: `Fulfillment timeline, allocation rationale, pick route and exception handling for order ${params.orderId}.`,
      },
      { property: "og:title", content: `${params.orderId} — Order detail · Nexus WMS` },
      { property: "og:description", content: "Line-level allocation, pick route and exception controls." },
    ],
  }),
  component: OrderDetail,
});

function OrderDetail() {
  const { orderId } = Route.useParams();
  const { state, advance, runAllocation, reportException } = useWarehouse();
  const order = state.orders.find((o) => o.id === orderId);

  if (!order)
    return (
      <Shell>
        <Panel title="Order not found">
          <Empty>
            No order with id {orderId}.{" "}
            <Link to="/orders" className="text-primary hover:underline">
              Back to queue
            </Link>
          </Empty>
        </Panel>
      </Shell>
    );

  const s = scoreOrder(order, state.clock);
  const plan = planAllocation(state, order.id);
  const route = pickRoute(order, state.products);
  const stageIdx = STAGE_FLOW.indexOf(order.status === "awaiting_stock" ? "new" : order.status);
  const allocatedUnits = order.lines.reduce((x, l) => x + l.allocated, 0);
  const neededUnits = order.lines.reduce((x, l) => x + l.qty, 0);

  return (
    <Shell>
      <Link to="/orders" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Order queue
      </Link>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="num text-3xl font-bold">{order.id}</h1>
            <PriorityBadge score={s.score} band={s.band} />
            <StatusChip status={order.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.customer} · {order.channel} · {order.tier} tier · ${order.value.toLocaleString()}
            {order.vip && " · VIP account"}
          </p>
        </div>
        <div className="flex gap-2">
          {["new", "awaiting_stock"].includes(order.status) && (
            <Button variant="secondary" onClick={() => runAllocation(order.id)}>
              Allocate stock
            </Button>
          )}
          {order.status !== "dispatched" && !["new", "awaiting_stock"].includes(order.status) && (
            <Button onClick={() => advance(order.id)}>
              Advance to {STAGE_FLOW[Math.min(stageIdx + 1, STAGE_FLOW.length - 1)]} <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="panel mb-5 px-4 py-4">
        <ol className="flex flex-wrap items-center gap-2">
          {STAGE_FLOW.map((st, i) => (
            <li key={st} className="flex items-center gap-2">
              <span
                className={`rounded-sm px-2 py-1 text-xs font-semibold uppercase tracking-wider ${
                  i < stageIdx
                    ? "bg-success/15 text-success"
                    : i === stageIdx
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground"
                }`}
              >
                {st.replace("_", " ")}
              </span>
              {i < STAGE_FLOW.length - 1 && <ArrowRight className="size-3.5 text-muted-foreground" />}
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="SLA" value={fmtH(s.hoursToSla)} tone={s.hoursToSla <= 0 ? "bad" : s.hoursToSla < 6 ? "warn" : "good"} hint={`promised ${order.promisedAt.slice(11, 16)} UTC`} />
        <Stat label="Units allocated" value={`${allocatedUnits}/${neededUnits}`} tone={allocatedUnits < neededUnits ? "warn" : "good"} />
        <Stat label="Pick route" value={`${route.metres} m`} hint={`${route.etaMin} min · ${route.savedPct}% shorter than bin order`} tone="info" />
        <Stat label="Backorder lines" value={order.backordered.length} tone={order.backordered.length ? "bad" : "good"} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Order lines" subtitle="Allocation, pick and pack state per SKU">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["SKU", "Item", "Bin", "Need", "Alloc", "Picked", "Free stock", "Exception"].map((h) => (
                    <th key={h} className="label-caps py-2 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => {
                  const p = state.products.find((x) => x.sku === l.sku)!;
                  return (
                    <tr key={l.sku} className="border-b border-border/60">
                      <td className="num py-2 pr-3">{l.sku}</td>
                      <td className="py-2 pr-3">{p.name}</td>
                      <td className="num py-2 pr-3 text-muted-foreground">{p.bin}</td>
                      <td className="num py-2 pr-3">{l.qty}</td>
                      <td className={`num py-2 pr-3 ${l.allocated < l.qty ? "text-warning" : "text-success"}`}>{l.allocated}</td>
                      <td className="num py-2 pr-3">{l.picked}</td>
                      <td className="num py-2 pr-3">{available(p)}</td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              reportException({ orderId: order.id, sku: l.sku, qty: 1, kind: "damaged" });
                              toast.warning("Damage logged", { description: "Resolution options generated in Exceptions." });
                            }}
                          >
                            <PackageX className="size-3.5" /> Damaged
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              reportException({ orderId: order.id, sku: l.sku, qty: 1, kind: "missing" });
                              toast.warning("Missing unit logged", { description: "Cycle-count option available in Exceptions." });
                            }}
                          >
                            Missing
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {order.backordered.length > 0 && (
            <div className="mt-3 rounded-sm border border-destructive/40 bg-destructive/10 p-3 text-xs">
              <p className="font-semibold text-destructive">Backordered</p>
              <ul className="num mt-1 space-y-0.5 text-muted-foreground">
                {order.backordered.map((b, i) => (
                  <li key={i}>
                    {b.qty} × {b.sku}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Why this priority" subtitle={`Score ${s.score}/100 · ${s.band}`}>
            <ul className="space-y-2">
              {s.reasons.map((r, i) => (
                <li key={i}>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="num font-semibold">+{r.points}</span>
                  </div>
                  <Bar pct={(r.points / 40) * 100} />
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Optimized pick route" subtitle={`${route.stops.length} stops · ${route.metres}m (naive ${route.naiveMetres}m)`}>
            {route.stops.length === 0 ? (
              <Empty>Nothing left to pick on this order.</Empty>
            ) : (
              <ol className="space-y-2">
                {route.stops.map((st, i) => (
                  <li key={st.sku} className="flex items-center gap-2 text-sm">
                    <span className="num grid size-6 shrink-0 place-items-center rounded-sm bg-secondary text-xs">{i + 1}</span>
                    <RouteIcon className="size-3.5 text-accent" />
                    <span className="num text-muted-foreground">{st.bin}</span>
                    <span className="truncate">{st.name}</span>
                    <span className="num ml-auto font-semibold">×{st.qty}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {plan.actions.length > 0 && (
            <Panel title="Allocation recommendation">
              <ul className="space-y-2 text-xs text-muted-foreground">
                {plan.actions.map((a, i) => (
                  <li key={i} className="rounded-sm border border-border p-2">
                    <span className="num font-semibold text-foreground">{a.type.toUpperCase()} {a.sku}</span>
                    <p className="mt-0.5">{a.rationale}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {order.notes.length > 0 && (
            <Panel title="Audit notes">
              <ul className="space-y-1 text-xs text-muted-foreground">
                {order.notes.map((n, i) => (
                  <li key={i}>· {n}</li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </Shell>
  );
}
