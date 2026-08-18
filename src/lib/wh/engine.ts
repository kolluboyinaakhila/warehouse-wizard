import {
  available,
  daysOfCover,
  type Order,
  type OrderStatus,
  type Product,
  type WhState,
} from "./types";

/* ------------------------------------------------------------------ *
 * 1. PRIORITY ENGINE — every order gets an explainable score 0..100  *
 * ------------------------------------------------------------------ */

const TIER_WEIGHT: Record<Order["tier"], number> = { express: 34, priority: 22, standard: 9 };

export type Scored = {
  score: number;
  band: "critical" | "high" | "normal";
  hoursToSla: number;
  reasons: { label: string; points: number }[];
};

export function scoreOrder(order: Order, now: string): Scored {
  const hoursToSla = +(
    (new Date(order.promisedAt).getTime() - new Date(now).getTime()) /
    3600_000
  ).toFixed(1);

  const reasons: { label: string; points: number }[] = [];
  reasons.push({ label: `${order.tier} service tier`, points: TIER_WEIGHT[order.tier] });

  // SLA urgency decays hard inside 6h and goes negative-time (breached) at max.
  const slaPts = hoursToSla <= 0 ? 40 : Math.round(Math.max(0, 38 - hoursToSla * 2.2));
  reasons.push({
    label: hoursToSla <= 0 ? "SLA breached" : `${hoursToSla}h to promised time`,
    points: slaPts,
  });

  const valuePts = Math.min(14, Math.round(order.value / 250));
  if (valuePts > 0) reasons.push({ label: `order value $${order.value.toLocaleString()}`, points: valuePts });

  if (order.vip) reasons.push({ label: "VIP / key account", points: 8 });
  if (order.channel === "b2b") reasons.push({ label: "B2B contract channel", points: 4 });
  if (order.backordered.length)
    reasons.push({ label: "has open backorder lines", points: 6 });

  const ageH = (new Date(now).getTime() - new Date(order.createdAt).getTime()) / 3600_000;
  const agePts = Math.min(6, Math.round(ageH / 4));
  if (agePts > 0) reasons.push({ label: `waiting ${ageH.toFixed(0)}h in queue`, points: agePts });

  const score = Math.max(0, Math.min(100, reasons.reduce((s, r) => s + r.points, 0)));
  const band = score >= 70 ? "critical" : score >= 45 ? "high" : "normal";
  return { score, band, hoursToSla, reasons };
}

/* ------------------------------------------------------------------ *
 * 2. ALLOCATION ENGINE — scarce stock to the orders that need it     *
 * ------------------------------------------------------------------ */

export type AllocAction =
  | { type: "full"; orderId: string; sku: string; qty: number; rationale: string }
  | { type: "partial"; orderId: string; sku: string; qty: number; short: number; rationale: string }
  | { type: "hold"; orderId: string; sku: string; short: number; rationale: string }
  | {
      type: "reallocate";
      orderId: string;
      fromOrderId: string;
      sku: string;
      qty: number;
      rationale: string;
    };

export type AllocPlan = { actions: AllocAction[]; summary: string };

/** Greedy priority-first allocation with pull-back from lower-priority holds. */
export function planAllocation(state: WhState, onlyOrderId?: string): AllocPlan {
  const pool = new Map<string, number>();
  state.products.forEach((p) => pool.set(p.sku, available(p)));

  const queue = state.orders
    .filter((o) => ["new", "awaiting_stock"].includes(o.status))
    .map((o) => ({ o, s: scoreOrder(o, state.clock) }))
    .sort((a, b) => b.s.score - a.s.score);

  // Soft reservations already held by lower-priority orders that are still pre-pick.
  const pullable = state.orders
    .filter((o) => o.status === "allocated")
    .map((o) => ({ o, s: scoreOrder(o, state.clock) }));

  const actions: AllocAction[] = [];

  for (const { o, s } of queue) {
    for (const line of o.lines) {
      const need = line.qty - line.allocated;
      if (need <= 0) continue;
      const have = pool.get(line.sku) ?? 0;
      const give = Math.min(need, have);
      if (give > 0) pool.set(line.sku, have - give);
      let short = need - give;

      if (short > 0 && s.band === "critical") {
        // Try to pull units back from a materially lower-priority allocated order.
        for (const cand of pullable.sort((a, b) => a.s.score - b.s.score)) {
          if (short <= 0) break;
          if (s.score - cand.s.score < 18) continue;
          const cl = cand.o.lines.find((l) => l.sku === line.sku && l.allocated > 0);
          if (!cl) continue;
          const take = Math.min(short, cl.allocated);
          actions.push({
            type: "reallocate",
            orderId: o.id,
            fromOrderId: cand.o.id,
            sku: line.sku,
            qty: take,
            rationale: `Pull ${take} from ${cand.o.id} (score ${cand.s.score}, ${cand.s.hoursToSla}h slack) to protect ${o.id} (score ${s.score}, ${s.hoursToSla}h to SLA). ${cand.o.id} can be refilled from inbound.`,
          });
          short -= take;
        }
      }

      if (short === 0 && give > 0) {
        actions.push({
          type: "full",
          orderId: o.id,
          sku: line.sku,
          qty: give,
          rationale: `Stock available — allocated in full (priority score ${s.score}).`,
        });
      } else if (give > 0) {
        actions.push({
          type: "partial",
          orderId: o.id,
          sku: line.sku,
          qty: give,
          short,
          rationale: `Only ${give} of ${need} on hand. Ship-partial recommended: ${o.tier} SLA in ${s.hoursToSla}h beats waiting for replenishment. Remaining ${short} moves to backorder.`,
        });
      } else if (short > 0) {
        actions.push({
          type: "hold",
          orderId: o.id,
          sku: line.sku,
          short,
          rationale: `No free stock. ${s.band === "normal" ? "Low urgency — hold whole line for inbound to avoid a split shipment." : "Hold and escalate replenishment."}`,
        });
      }
    }
  }

  const full = actions.filter((a) => a.type === "full").length;
  const partial = actions.filter((a) => a.type === "partial").length;
  const holds = actions.filter((a) => a.type === "hold").length;
  const pulls = actions.filter((a) => a.type === "reallocate").length;
  const plan = onlyOrderId ? actions.filter((a) => a.orderId === onlyOrderId) : actions;
  return {
    actions: plan,
    summary: `${full} lines allocated in full · ${partial} partial ship · ${holds} held for stock · ${pulls} priority reallocation${pulls === 1 ? "" : "s"}`,
  };
}

/* ------------------------------------------------------------------ *
 * 3. REPLENISHMENT ENGINE                                            *
 * ------------------------------------------------------------------ */

export type Reorder = {
  sku: string;
  name: string;
  qty: number;
  urgency: "now" | "today" | "this week";
  reason: string;
  cost: number;
};

export function reorderPlan(state: WhState): Reorder[] {
  const demand = new Map<string, number>();
  state.orders
    .filter((o) => o.status !== "dispatched" && o.status !== "cancelled")
    .forEach((o) =>
      o.lines.forEach((l) =>
        demand.set(l.sku, (demand.get(l.sku) ?? 0) + (l.qty - l.allocated)),
      ),
    );

  return state.products
    .map((p) => {
      const open = demand.get(p.sku) ?? 0;
      const cover = daysOfCover(p);
      const target = Math.ceil(
        p.reorderPoint + p.dailyVelocity * p.leadTimeDays + open - p.inbound,
      );
      const qty = Math.max(0, target - available(p));
      const urgency: Reorder["urgency"] =
        available(p) === 0 || open > available(p) ? "now" : cover < p.leadTimeDays ? "today" : "this week";
      const reason =
        available(p) === 0
          ? `Stocked out with ${open} units of open demand${p.inbound ? `; ${p.inbound} inbound` : ""}.`
          : open > available(p)
            ? `Open demand ${open} exceeds free stock ${available(p)} — will cause holds.`
            : `${cover}d cover vs ${p.leadTimeDays}d lead time.`;
      return { sku: p.sku, name: p.name, qty, urgency, reason, cost: Math.round(qty * p.unitCost) };
    })
    .filter((r) => r.qty > 0 && (r.urgency !== "this week" || r.qty > 0))
    .filter((r) => {
      const p = state.products.find((x) => x.sku === r.sku)!;
      return available(p) <= p.reorderPoint || (demand.get(p.sku) ?? 0) > available(p);
    })
    .sort((a, b) => ({ now: 0, today: 1, "this week": 2 })[a.urgency] - ({ now: 0, today: 1, "this week": 2 })[b.urgency]);
}

/* ------------------------------------------------------------------ *
 * 4. PICK PATH OPTIMISATION                                          *
 * ------------------------------------------------------------------ */

export type PickStop = { sku: string; name: string; bin: string; zone: string; aisle: number; qty: number };

export function pickRoute(order: Order, products: Product[]) {
  const stops: PickStop[] = order.lines
    .filter((l) => l.allocated > l.picked)
    .map((l) => {
      const p = products.find((x) => x.sku === l.sku)!;
      return {
        sku: l.sku,
        name: p.name,
        bin: p.bin,
        zone: p.zone,
        aisle: p.aisle,
        qty: l.allocated - l.picked,
      };
    });

  const dist = (a: PickStop[]) =>
    a.reduce((sum, s, i) => sum + (i === 0 ? s.aisle * 6 : Math.abs(s.aisle - a[i - 1]!.aisle) * 6 + 4), 0);

  const optimized = [...stops].sort((a, b) =>
    a.zone === b.zone ? a.aisle - b.aisle || a.bin.localeCompare(b.bin) : a.zone.localeCompare(b.zone),
  );
  const naive = dist(stops);
  const best = dist(optimized);
  return {
    stops: optimized,
    metres: best,
    naiveMetres: naive,
    savedPct: naive > 0 ? Math.max(0, Math.round(((naive - best) / naive) * 100)) : 0,
    etaMin: Math.max(1, Math.round(best / 55 + optimized.length * 0.6)),
  };
}

/** Batch pickers: group same-zone orders so one walk serves several orders. */
export function pickWaves(state: WhState) {
  const ready = state.orders.filter((o) => o.status === "allocated" || o.status === "picking");
  const byZone = new Map<string, { zone: string; orders: Order[]; units: number }>();
  ready.forEach((o) => {
    const zones = new Set(
      o.lines.map((l) => state.products.find((p) => p.sku === l.sku)?.zone ?? "?"),
    );
    const key = [...zones].sort().join("+");
    const w = byZone.get(key) ?? { zone: key, orders: [], units: 0 };
    w.orders.push(o);
    w.units += o.lines.reduce((s, l) => s + (l.allocated - l.picked), 0);
    byZone.set(key, w);
  });
  return [...byZone.values()].sort((a, b) => b.orders.length - a.orders.length);
}

/* ------------------------------------------------------------------ *
 * 5. BOTTLENECK / THROUGHPUT ANALYTICS                               *
 * ------------------------------------------------------------------ */

const CAPACITY: Partial<Record<OrderStatus, number>> = {
  picking: 4,
  packing: 3,
  qc: 2,
  allocated: 8,
};

export function stageStats(state: WhState) {
  const stages: OrderStatus[] = ["new", "awaiting_stock", "allocated", "picking", "packing", "qc", "dispatched"];
  return stages.map((stage) => {
    const orders = state.orders.filter((o) => o.status === stage);
    const dwell =
      orders.length === 0
        ? 0
        : +(
            orders.reduce(
              (s, o) => s + (new Date(state.clock).getTime() - new Date(o.stageEnteredAt).getTime()) / 3600_000,
              0,
            ) / orders.length
          ).toFixed(1);
    const cap = CAPACITY[stage];
    const load = cap ? Math.round((orders.length / cap) * 100) : 0;
    return { stage, count: orders.length, dwell, cap, load };
  });
}

export function bottlenecks(state: WhState) {
  return stageStats(state)
    .filter((s) => s.cap && (s.load >= 100 || s.dwell > 3))
    .map((s) => ({
      stage: s.stage,
      severity: s.load >= 150 || s.dwell > 5 ? ("critical" as const) : ("warning" as const),
      message:
        s.load >= 100
          ? `${s.stage} is at ${s.load}% of capacity (${s.count}/${s.cap}) — queue will not drain this hour.`
          : `${s.stage} average dwell ${s.dwell}h exceeds 3h target.`,
      action:
        s.stage === "picking"
          ? "Move 1 packer to picking and run a batched wave for zone A+B."
          : s.stage === "packing"
            ? "Open the third packing station; pre-stage cartons for multi-line orders."
            : s.stage === "qc"
              ? "Switch to sampled QC (100% only for exception-flagged orders)."
              : "Run the allocation engine to clear the pre-pick queue.",
    }));
}

export function slaRisk(state: WhState) {
  return state.orders
    .filter((o) => o.status !== "dispatched" && o.status !== "cancelled")
    .map((o) => ({ order: o, s: scoreOrder(o, state.clock) }))
    .filter((x) => x.s.hoursToSla < 6)
    .sort((a, b) => a.s.hoursToSla - b.s.hoursToSla);
}
