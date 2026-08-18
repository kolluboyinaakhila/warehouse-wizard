import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, Panel, Stat } from "@/components/wh/bits";
import { Shell } from "@/components/wh/shell";
import { useWarehouse } from "@/lib/wh/store";

export const Route = createFileRoute("/exceptions")({
  head: () => ({
    meta: [
      { title: "Exception Desk — Nexus WMS" },
      {
        name: "description",
        content:
          "Exception to decision to resolution: damaged units, missing stock, shortfalls and QC failures with recommended resolutions.",
      },
      { property: "og:title", content: "Exception Desk — Nexus WMS" },
      { property: "og:description", content: "Every warehouse exception gets a recommended resolution path." },
    ],
  }),
  component: ExceptionsPage,
});

function ExceptionsPage() {
  const { state, resolveException } = useWarehouse();
  const open = state.exceptions.filter((e) => e.status === "open");
  const resolved = state.exceptions.filter((e) => e.status === "resolved");

  return (
    <Shell>
      <div className="mb-5">
        <p className="label-caps">Exception → decision → resolution</p>
        <h1 className="text-3xl font-bold">Exception desk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing silently stalls: every damaged unit, missing pick, stock shortfall or QC failure lands here with ranked
          resolution options.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open exceptions" value={open.length} tone={open.length ? "bad" : "good"} />
        <Stat label="Resolved this shift" value={resolved.length} tone="good" />
        <Stat
          label="Orders impacted"
          value={new Set(state.exceptions.map((e) => e.orderId).filter(Boolean)).size}
          tone="warn"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {open.length === 0 ? (
            <Panel title="Open exceptions">
              <Empty>Clear desk — no open exceptions. Report one from an order line or the stock ledger.</Empty>
            </Panel>
          ) : (
            open.map((e) => (
              <Panel
                key={e.id}
                title={`${e.kind.replace("_", " ").toUpperCase()} · ${e.sku}`}
                subtitle={`${e.id} · detected ${e.detectedAt.slice(11, 16)} UTC${e.orderId ? ` · ${e.orderId}` : ""}`}
                action={<AlertTriangle className="size-5 text-destructive" />}
              >
                <p className="text-sm text-muted-foreground">{e.detail}</p>
                {e.orderId && (
                  <Link
                    to="/orders/$orderId"
                    params={{ orderId: e.orderId }}
                    className="num mt-1 inline-block text-xs text-primary hover:underline"
                  >
                    Open {e.orderId} →
                  </Link>
                )}
                <ul className="mt-3 space-y-2">
                  {e.options.map((o) => (
                    <li
                      key={o.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-sm border p-3 ${
                        o.recommended ? "border-primary/50 bg-primary/10" : "border-border bg-surface-2/60"
                      }`}
                    >
                      <div className="min-w-56 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-semibold">
                          {o.recommended && <Sparkles className="size-3.5 text-primary" />}
                          {o.label}
                          {o.recommended && (
                            <span className="rounded-sm bg-primary/20 px-1 text-[10px] uppercase tracking-wider text-primary">
                              recommended
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{o.detail}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={o.recommended ? "default" : "secondary"}
                        onClick={() => {
                          resolveException(e.id, o.id);
                          toast.success(`${e.id} resolved`, { description: o.label });
                        }}
                      >
                        Apply
                      </Button>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))
          )}
        </div>

        <Panel title="Resolution history" subtitle="Auditable trail of what was decided and why">
          {resolved.length === 0 ? (
            <Empty>No resolutions yet.</Empty>
          ) : (
            <ul className="space-y-3">
              {resolved.map((e) => (
                <li key={e.id} className="border-l-2 border-success pl-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <CheckCircle2 className="size-3.5 text-success" />
                    {e.kind.replace("_", " ")} · <span className="num">{e.sku}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{e.resolution}</p>
                  {e.orderId && <p className="num text-[11px] text-muted-foreground">{e.orderId}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
