import { createFileRoute } from "@tanstack/react-router";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Sparkles } from "lucide-react";
import { Empty, Panel, Stat } from "@/components/wh/bits";
import { Shell } from "@/components/wh/shell";
import { bottlenecks, scoreOrder, stageStats } from "@/lib/wh/engine";
import { useWarehouse } from "@/lib/wh/store";
import { available, stockState } from "@/lib/wh/types";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Operational Analytics — Nexus WMS" },
      {
        name: "description",
        content:
          "Throughput, stage dwell time, SLA performance, exception mix and bottleneck diagnosis for the warehouse floor.",
      },
      { property: "og:title", content: "Operational Analytics — Nexus WMS" },
      { property: "og:description", content: "Bottleneck identification and SLA performance analytics." },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { state } = useWarehouse();
  const stages = stageStats(state);
  const necks = bottlenecks(state);

  const scored = state.orders.map((o) => ({ o, s: scoreOrder(o, state.clock) }));
  const dispatched = scored.filter(({ o }) => o.status === "dispatched");
  const onTime = dispatched.filter(({ s }) => s.hoursToSla > 0).length;
  const slaPct = dispatched.length ? Math.round((onTime / dispatched.length) * 100) : 100;
  const breaching = scored.filter(({ o, s }) => o.status !== "dispatched" && s.hoursToSla <= 0).length;

  const stageData = stages
    .filter((s) => s.stage !== "dispatched")
    .map((s) => ({ stage: s.stage.replace("_", " "), orders: s.count, dwell: s.dwell, load: s.load }));

  const excMix = ["damaged", "missing", "shortfall", "qc_fail"].map((k) => ({
    kind: k.replace("_", " "),
    count: state.exceptions.filter((e) => e.kind === k).length,
  }));

  const coverData = state.products
    .map((p) => ({ sku: p.sku.replace("SKU-", ""), free: available(p), rop: p.reorderPoint, state: stockState(p) }))
    .sort((a, b) => a.free / Math.max(1, a.rop) - b.free / Math.max(1, b.rop));

  const throughput = [0, 1, 2, 3, 4, 5].map((i) => ({
    hour: `H${i}`,
    dispatched: state.log.filter((l) => l.title.includes("dispatched")).length ? Math.max(0, dispatched.length - (5 - i)) : 0,
    received: state.orders.filter((o) => new Date(o.createdAt).getTime() <= new Date(state.clock).getTime()).length - (5 - i),
  }));

  const chartTip = {
    contentStyle: {
      background: "var(--popover)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      fontSize: 12,
    },
  };

  return (
    <Shell>
      <div className="mb-5">
        <p className="label-caps">Operational analytics</p>
        <h1 className="text-3xl font-bold">Where the flow breaks</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="On-time dispatch" value={`${slaPct}%`} tone={slaPct >= 95 ? "good" : slaPct >= 85 ? "warn" : "bad"} hint={`${dispatched.length} shipped`} />
        <Stat label="SLA breaches open" value={breaching} tone={breaching ? "bad" : "good"} />
        <Stat label="Exceptions raised" value={state.exceptions.length} tone="warn" hint={`${state.exceptions.filter((e) => e.status === "resolved").length} resolved`} />
        <Stat label="Constrained stages" value={necks.length} tone={necks.length ? "bad" : "good"} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="WIP and dwell time by stage" subtitle="Tall bars with high dwell are your constraint">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="stage" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip {...chartTip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <RBar dataKey="orders" name="orders in stage" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
                <RBar dataKey="dwell" name="avg dwell (h)" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Order intake vs dispatch" subtitle="Widening gap means the floor is falling behind">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={throughput}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="hour" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip {...chartTip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="received" name="orders received" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="dispatched" name="orders dispatched" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Free stock vs reorder point" subtitle="Red bars are the SKUs that will block orders next">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={coverData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="sku" stroke="var(--muted-foreground)" fontSize={10} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip {...chartTip} />
                <RBar dataKey="free" name="free stock" radius={[3, 3, 0, 0]}>
                  {coverData.map((d) => (
                    <Cell
                      key={d.sku}
                      fill={
                        d.state === "out" || d.state === "low"
                          ? "var(--chart-4)"
                          : d.state === "watch"
                            ? "var(--chart-1)"
                            : "var(--chart-3)"
                      }
                    />
                  ))}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Exception mix" subtitle="Recurring categories point at process fixes, not people">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={excMix} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="kind" stroke="var(--muted-foreground)" fontSize={11} width={70} />
                <Tooltip {...chartTip} />
                <RBar dataKey="count" name="exceptions" fill="var(--chart-5)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel className="mt-5" title="Diagnosis & recommended interventions">
        {necks.length === 0 ? (
          <Empty>No stage is constrained — throughput matches intake.</Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {necks.map((b) => (
              <li key={b.stage} className="rounded-sm border border-border bg-surface-2/60 p-3">
                <p className={`text-sm font-semibold ${b.severity === "critical" ? "text-destructive" : "text-warning"}`}>
                  {b.stage.replace("_", " ")} · {b.severity}
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
    </Shell>
  );
}
