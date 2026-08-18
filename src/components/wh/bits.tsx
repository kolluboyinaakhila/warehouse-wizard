import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/wh/types";
import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            {title && <h2 className="text-base font-semibold tracking-wide">{title}</h2>}
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad" | "info";
}) {
  const tones = {
    default: "text-foreground",
    good: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
    info: "text-accent",
  } as const;
  return (
    <div className="panel px-4 py-3">
      <p className="label-caps">{label}</p>
      <p className={cn("num mt-1 text-3xl font-semibold leading-none", tones[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  new: "bg-muted text-muted-foreground",
  awaiting_stock: "bg-destructive/15 text-destructive",
  allocated: "bg-info/15 text-info",
  picking: "bg-primary/15 text-primary",
  packing: "bg-accent/15 text-accent",
  qc: "bg-warning/15 text-warning",
  dispatched: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

export function StatusChip({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        STATUS_STYLE[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current pulse-dot" />
      {status.replace("_", " ")}
    </span>
  );
}

export function PriorityBadge({
  score,
  band,
}: {
  score: number;
  band: "critical" | "high" | "normal";
}) {
  const styles = {
    critical: "border-destructive/50 bg-destructive/15 text-destructive",
    high: "border-primary/50 bg-primary/15 text-primary",
    normal: "border-border bg-muted text-muted-foreground",
  } as const;
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-semibold",
        styles[band],
      )}
      title={`Priority score ${score}/100 (${band})`}
    >
      P{score}
    </span>
  );
}

export function Bar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "warn" | "bad" | "good" }) {
  const tones = { primary: "bg-primary", warn: "bg-warning", bad: "bg-destructive", good: "bg-success" } as const;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className={cn("h-full rounded-full transition-all", tones[tone])} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export const fmtH = (h: number) => (h <= 0 ? `${Math.abs(h).toFixed(1)}h late` : `${h.toFixed(1)}h left`);
