import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bar, Empty, Panel, Stat } from "@/components/wh/bits";
import { Shell } from "@/components/wh/shell";
import { reorderPlan } from "@/lib/wh/engine";
import { useWarehouse } from "@/lib/wh/store";
import { available, daysOfCover, stockState } from "@/lib/wh/types";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory & Replenishment — Nexus WMS" },
      {
        name: "description",
        content:
          "Bin-level stock visibility with reserved units, days of cover, low-stock detection and reorder quantity recommendations.",
      },
      { property: "og:title", content: "Inventory & Replenishment — Nexus WMS" },
      { property: "og:description", content: "Low-stock detection and reorder recommendations for every SKU." },
    ],
  }),
  component: InventoryPage,
});

const TONE = {
  out: "text-destructive",
  low: "text-warning",
  watch: "text-primary",
  healthy: "text-success",
} as const;

function InventoryPage() {
  const { state, receiveStock, reportException } = useWarehouse();
  const [q, setQ] = useState("");
  const reorders = reorderPlan(state);

  const products = state.products.filter((p) =>
    q ? (p.sku + p.name + p.zone).toLowerCase().includes(q.toLowerCase()) : true,
  );

  const out = state.products.filter((p) => stockState(p) === "out").length;
  const low = state.products.filter((p) => ["low", "watch"].includes(stockState(p))).length;
  const value = state.products.reduce((s, p) => s + p.onHand * p.unitCost, 0);

  return (
    <Shell>
      <div className="mb-5">
        <p className="label-caps">Inventory control</p>
        <h1 className="text-3xl font-bold">Stock health & replenishment</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="SKUs tracked" value={state.products.length} />
        <Stat label="Out of stock" value={out} tone={out ? "bad" : "good"} />
        <Stat label="At / below reorder point" value={low} tone={low ? "warn" : "good"} />
        <Stat label="On-hand value" value={`$${Math.round(value / 1000)}k`} tone="info" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Stock ledger" subtitle="Free stock = on hand − reserved">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, name or zone" className="mb-3 h-8 max-w-xs" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["SKU", "Item", "Bin", "On hand", "Reserved", "Free", "Cover", "Health", ""].map((h) => (
                    <th key={h} className="label-caps py-2 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const st = stockState(p);
                  return (
                    <tr key={p.sku} className="border-b border-border/60 hover:bg-surface-2/50">
                      <td className="num py-2 pr-3">{p.sku}</td>
                      <td className="py-2 pr-3">
                        {p.name}
                        {p.damaged > 0 && (
                          <span className="num ml-2 rounded-sm bg-destructive/15 px-1 text-[10px] text-destructive">
                            {p.damaged} dmg
                          </span>
                        )}
                      </td>
                      <td className="num py-2 pr-3 text-muted-foreground">
                        {p.zone}·{p.bin}
                      </td>
                      <td className="num py-2 pr-3">{p.onHand}</td>
                      <td className="num py-2 pr-3 text-accent">{p.reserved}</td>
                      <td className={`num py-2 pr-3 font-semibold ${TONE[st]}`}>{available(p)}</td>
                      <td className="num py-2 pr-3">{daysOfCover(p)}d</td>
                      <td className="w-28 py-2 pr-3">
                        <Bar
                          pct={(available(p) / Math.max(1, p.reorderPoint * 2)) * 100}
                          tone={st === "out" || st === "low" ? "bad" : st === "watch" ? "warn" : "good"}
                        />
                        <span className={`text-[10px] uppercase tracking-wider ${TONE[st]}`}>{st}</span>
                      </td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          {p.inbound > 0 && (
                            <Button size="sm" variant="ghost" onClick={() => { receiveStock(p.sku, p.inbound); toast.success(`Received ${p.inbound} × ${p.sku}`); }}>
                              <Truck className="size-3.5" /> Receive {p.inbound}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { reportException({ sku: p.sku, qty: 2, kind: "missing" }); toast.warning("Cycle-count exception raised"); }}
                          >
                            Count discrepancy
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Reorder recommendations" subtitle="Qty = reorder point + lead-time demand + open demand − inbound">
          {reorders.length === 0 ? (
            <Empty>No replenishment needed this shift.</Empty>
          ) : (
            <ul className="space-y-3">
              {reorders.map((r) => (
                <li key={r.sku} className="rounded-sm border border-border bg-surface-2/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{r.name}</p>
                      <p className="num text-xs text-muted-foreground">{r.sku}</p>
                    </div>
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        r.urgency === "now" ? "bg-destructive/15 text-destructive" : r.urgency === "today" ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {r.urgency}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="num text-sm font-semibold text-primary">Order {r.qty} units · ${r.cost.toLocaleString()}</span>
                    <Button size="sm" variant="secondary" onClick={() => { receiveStock(r.sku, r.qty); toast.success(`PO raised & received: ${r.qty} × ${r.sku}`, { description: "Demo shortcut — stock is immediately allocatable." }); }}>
                      Raise PO
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
