import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Panel, PriorityBadge, StatusChip, fmtH } from "@/components/wh/bits";
import { Shell } from "@/components/wh/shell";
import { scoreOrder } from "@/lib/wh/engine";
import { useWarehouse } from "@/lib/wh/store";
import type { Order, Tier } from "@/lib/wh/types";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "Order Queue & Prioritization — Nexus WMS" },
      {
        name: "description",
        content:
          "Every order scored on service tier, SLA slack, value and account weight so the floor always works the right order next.",
      },
      { property: "og:title", content: "Order Queue & Prioritization — Nexus WMS" },
      { property: "og:description", content: "Explainable order priority scoring for warehouse teams." },
    ],
  }),
  component: OrdersPage,
});

const FILTERS = ["all", "needs stock", "in progress", "dispatched"] as const;

function OrdersPage() {
  const { state, runAllocation, expedite, createOrder } = useWarehouse();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    return state.orders
      .map((o) => ({ o, s: scoreOrder(o, state.clock) }))
      .filter(({ o }) => {
        if (filter === "needs stock") return ["new", "awaiting_stock"].includes(o.status);
        if (filter === "in progress") return ["allocated", "picking", "packing", "qc"].includes(o.status);
        if (filter === "dispatched") return o.status === "dispatched";
        return true;
      })
      .filter(({ o }) =>
        q ? (o.id + o.customer).toLowerCase().includes(q.toLowerCase()) : true,
      )
      .sort((a, b) => b.s.score - a.s.score);
  }, [state.orders, state.clock, filter, q]);

  const addDemoOrder = () => {
    const tiers: Tier[] = ["express", "priority", "standard"];
    const n = 4831 + state.orders.filter((o) => o.id.startsWith("ORD-48")).length;
    const tier = tiers[Math.floor(Math.random() * 3)]!;
    const pool = state.products;
    const lines = Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => {
      const p = pool[Math.floor(Math.random() * pool.length)]!;
      return { sku: p.sku, qty: 1 + Math.floor(Math.random() * 6), allocated: 0, picked: 0, packed: 0 };
    });
    const order: Order = {
      id: `ORD-${n}`,
      customer: ["L. Sharma", "Cobalt Retail", "Anka Systems", "T. Nguyen"][Math.floor(Math.random() * 4)]!,
      channel: "web",
      tier,
      value: lines.reduce((s, l) => s + l.qty * 40, 0),
      vip: tier === "express",
      createdAt: state.clock,
      promisedAt: new Date(
        new Date(state.clock).getTime() + (tier === "express" ? 4 : tier === "priority" ? 14 : 48) * 3600_000,
      ).toISOString(),
      status: "new",
      lines,
      backordered: [],
      notes: [],
      stageEnteredAt: state.clock,
    };
    createOrder(order);
    toast.success(`${order.id} received`, { description: "Priority scored on intake — run allocation to commit stock." });
  };

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Order management</p>
          <h1 className="text-3xl font-bold">Priority queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Score = tier weight + SLA urgency + order value + account weight + queue age. Highest score is picked first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={addDemoOrder}>
            <Plus className="size-4" /> Simulate inbound order
          </Button>
          <Button onClick={() => runAllocation()}>Run allocation</Button>
        </div>
      </div>

      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-sm border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                filter === f ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search order or customer"
            className="ml-auto h-8 w-56"
          />
        </div>

        {rows.length === 0 ? (
          <Empty>No orders match this view.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Priority", "Order", "Customer", "Tier", "Lines", "Allocated", "SLA", "Status", ""].map((h) => (
                    <th key={h} className="label-caps py-2 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ o, s }) => {
                  const alloc = o.lines.reduce((x, l) => x + l.allocated, 0);
                  const need = o.lines.reduce((x, l) => x + l.qty, 0);
                  return (
                    <tr key={o.id} className="border-b border-border/60 hover:bg-surface-2/50">
                      <td className="py-2 pr-3">
                        <PriorityBadge score={s.score} band={s.band} />
                      </td>
                      <td className="num py-2 pr-3 font-semibold">
                        <Link to="/orders/$orderId" params={{ orderId: o.id }} className="hover:underline">
                          {o.id}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{o.customer}</td>
                      <td className="py-2 pr-3 text-xs uppercase tracking-wider text-muted-foreground">{o.tier}</td>
                      <td className="num py-2 pr-3">{o.lines.length}</td>
                      <td className="num py-2 pr-3">
                        <span className={alloc < need ? "text-warning" : "text-success"}>
                          {alloc}/{need}
                        </span>
                      </td>
                      <td className={`num py-2 pr-3 ${s.hoursToSla <= 0 ? "text-destructive" : s.hoursToSla < 6 ? "text-warning" : ""}`}>
                        {fmtH(s.hoursToSla)}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusChip status={o.status} />
                      </td>
                      <td className="py-2">
                        {o.tier !== "express" && o.status !== "dispatched" && (
                          <Button size="sm" variant="ghost" onClick={() => expedite(o.id)} title="Escalate to express">
                            <Zap className="size-3.5" /> Expedite
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Shell>
  );
}
