import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { initialState } from "./data";
import { planAllocation, scoreOrder } from "./engine";
import {
  STAGE_FLOW,
  available,
  type ExceptionKind,
  type Order,
  type OrderStatus,
  type WhException,
  type WhState,
} from "./types";

type Action =
  | { type: "run_allocation"; orderId?: string }
  | { type: "advance"; orderId: string }
  | { type: "assign"; orderId: string; picker: string }
  | { type: "report_exception"; orderId?: string; sku: string; qty: number; kind: ExceptionKind; detail?: string }
  | { type: "resolve_exception"; id: string; optionId: string }
  | { type: "receive_stock"; sku: string; qty: number }
  | { type: "create_order"; order: Order }
  | { type: "expedite"; orderId: string }
  | { type: "tick"; hours: number }
  | { type: "restore"; state: WhState }
  | { type: "reset" };

let seq = 1;
const nid = (p: string) => `${p}-${seq++}`;

const log = (s: WhState, kind: "decision" | "event" | "exception", title: string, detail: string, orderId?: string): WhState => ({
  ...s,
  log: [
    { id: nid("LOG"), at: s.clock, kind, title, detail, ...(orderId ? { orderId } : {}) },
    ...s.log,
  ].slice(0, 200),
});

const touch = (o: Order, status: OrderStatus, clock: string): Order => ({
  ...o,
  status,
  stageEnteredAt: clock,
});

function exceptionOptions(kind: ExceptionKind, sku: string, qty: number, orderId?: string) {
  if (kind === "qc_fail")
    return [
      { id: "repick", label: "Re-pick replacement units", detail: `Send ${orderId} back to picking for ${qty} replacement unit(s); failed units quarantined.`, recommended: true },
      { id: "ship_partial", label: "Ship what passed QC", detail: "Dispatch passing units now, backorder the rest to protect the SLA." },
      { id: "hold", label: "Hold full order", detail: "Keep the order in QC until replacements are verified." },
    ];
  return [
    {
      id: "repick_other_bin",
      label: "Re-pick from alternate bin",
      detail: `Pull ${qty} × ${sku} from overflow/reserve stock and keep the order on its current SLA.`,
      recommended: true,
    },
    {
      id: "partial_ship",
      label: "Ship partial + backorder",
      detail: `Dispatch available units now, backorder ${qty} × ${sku} against the next inbound receipt.`,
    },
    {
      id: "writeoff",
      label: kind === "damaged" ? "Write off & cycle count" : "Write off & trigger cycle count",
      detail: `Adjust ${sku} inventory by -${qty}, flag the bin for a same-shift cycle count and reorder.`,
    },
  ];
}

function applyAllocation(state: WhState, orderId?: string): WhState {
  const plan = planAllocation(state, orderId);
  if (plan.actions.length === 0) return log(state, "decision", "Allocation engine ran", "No allocatable demand found.");

  let products = state.products.map((p) => ({ ...p }));
  let orders = state.orders.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })), backordered: [...o.backordered], notes: [...o.notes] }));
  let next = { ...state, products, orders };

  const P = (sku: string) => products.find((p) => p.sku === sku)!;
  const Ord = (id: string) => orders.find((o) => o.id === id)!;

  for (const a of plan.actions) {
    if (a.type === "reallocate") {
      const from = Ord(a.fromOrderId);
      const fl = from.lines.find((l) => l.sku === a.sku)!;
      fl.allocated -= a.qty;
      from.backordered.push({ sku: a.sku, qty: a.qty });
      from.notes.push(`${a.qty} × ${a.sku} reallocated to ${a.orderId} — refill from inbound.`);
      from.status = "awaiting_stock";
      const to = Ord(a.orderId);
      to.lines.find((l) => l.sku === a.sku)!.allocated += a.qty;
      next = log(next, "decision", `Reallocated ${a.qty} × ${a.sku}`, a.rationale, a.orderId);
    } else if (a.type === "full" || a.type === "partial") {
      const p = P(a.sku);
      p.reserved += a.qty;
      const o = Ord(a.orderId);
      o.lines.find((l) => l.sku === a.sku)!.allocated += a.qty;
      if (a.type === "partial") {
        o.backordered.push({ sku: a.sku, qty: a.short });
        next = log(next, "decision", `Partial allocation on ${a.orderId}`, a.rationale, a.orderId);
      }
    } else if (a.type === "hold") {
      const o = Ord(a.orderId);
      o.backordered.push({ sku: a.sku, qty: a.short });
      next = log(next, "decision", `Line held on ${a.orderId}`, a.rationale, a.orderId);
      next = {
        ...next,
        exceptions: [
          {
            id: nid("EXC"),
            kind: "shortfall",
            orderId: a.orderId,
            sku: a.sku,
            qty: a.short,
            detectedAt: state.clock,
            status: "open",
            detail: `${a.short} × ${a.sku} unavailable for ${a.orderId}.`,
            options: exceptionOptions("shortfall", a.sku, a.short, a.orderId),
          },
          ...next.exceptions,
        ],
      };
    }
  }

  orders = orders.map((o) => {
    if (!["new", "awaiting_stock"].includes(o.status)) return o;
    const anyAlloc = o.lines.some((l) => l.allocated > 0);
    const fully = o.lines.every((l) => l.allocated >= l.qty);
    if (fully || anyAlloc) return touch(o, "allocated", state.clock);
    return touch(o, "awaiting_stock", state.clock);
  });

  next = { ...next, orders, products };
  return log(next, "decision", "Allocation engine ran", plan.summary);
}

const KEY = "nexus-wms-state-v1";

function reducer(state: WhState, action: Action): WhState {
  switch (action.type) {
    case "restore":
      return action.state;

    case "reset":
      return initialState();

    case "run_allocation":
      return applyAllocation(state, action.orderId);

    case "assign":
      return {
        ...state,
        orders: state.orders.map((o) =>
          o.id === action.orderId ? { ...o, assignedTo: action.picker } : o,
        ),
      };

    case "expedite": {
      const o = state.orders.find((x) => x.id === action.orderId);
      if (!o) return state;
      return log(
        {
          ...state,
          orders: state.orders.map((x) =>
            x.id === action.orderId ? { ...x, tier: "express", notes: [...x.notes, "Manually expedited by supervisor."] } : x,
          ),
        },
        "decision",
        `${o.id} expedited`,
        "Escalated to express tier — jumps the pick queue on the next wave.",
        o.id,
      );
    }

    case "advance": {
      const order = state.orders.find((o) => o.id === action.orderId);
      if (!order) return state;
      const idx = STAGE_FLOW.indexOf(order.status === "awaiting_stock" ? "allocated" : order.status);
      const nextStage = STAGE_FLOW[Math.min(idx + 1, STAGE_FLOW.length - 1)]!;
      let products = state.products.map((p) => ({ ...p }));
      let lines = order.lines.map((l) => ({ ...l }));

      if (nextStage === "packing") lines = lines.map((l) => ({ ...l, picked: l.allocated }));
      if (nextStage === "qc") lines = lines.map((l) => ({ ...l, packed: l.picked }));
      if (nextStage === "dispatched") {
        products = products.map((p) => {
          const l = lines.find((x) => x.sku === p.sku);
          if (!l) return p;
          return { ...p, onHand: p.onHand - l.allocated, reserved: Math.max(0, p.reserved - l.allocated) };
        });
      }

      const updated: Order = { ...touch(order, nextStage, state.clock), lines };
      const next = {
        ...state,
        products,
        orders: state.orders.map((o) => (o.id === order.id ? updated : o)),
      };
      return log(
        next,
        "event",
        `${order.id} → ${nextStage}`,
        nextStage === "dispatched"
          ? `Dispatched to ${order.customer}. Inventory decremented, reservations released.`
          : `Moved from ${order.status} to ${nextStage}.`,
        order.id,
      );
    }

    case "report_exception": {
      const exc: WhException = {
        id: nid("EXC"),
        kind: action.kind,
        ...(action.orderId ? { orderId: action.orderId } : {}),
        sku: action.sku,
        qty: action.qty,
        detectedAt: state.clock,
        status: "open",
        detail:
          action.detail ??
          (action.kind === "damaged"
            ? `${action.qty} × ${action.sku} found damaged at pick face.`
            : action.kind === "missing"
              ? `${action.qty} × ${action.sku} missing from bin — inventory record mismatch.`
              : `QC failed on ${action.qty} × ${action.sku}.`),
        options: exceptionOptions(action.kind, action.sku, action.qty, action.orderId),
      };
      const products = state.products.map((p) =>
        p.sku === action.sku && action.kind !== "shortfall"
          ? { ...p, damaged: p.damaged + (action.kind === "damaged" ? action.qty : 0) }
          : p,
      );
      return log(
        { ...state, products, exceptions: [exc, ...state.exceptions] },
        "exception",
        `${action.kind.toUpperCase()} · ${action.sku}`,
        exc.detail,
        action.orderId,
      );
    }

    case "resolve_exception": {
      const exc = state.exceptions.find((e) => e.id === action.id);
      if (!exc) return state;
      const option = exc.options.find((o) => o.id === action.optionId)!;
      let products = state.products.map((p) => ({ ...p }));
      let orders = state.orders.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })), notes: [...o.notes], backordered: [...o.backordered] }));
      const p = products.find((x) => x.sku === exc.sku);
      const o = orders.find((x) => x.id === exc.orderId);

      if (action.optionId === "writeoff" && p) {
        p.onHand = Math.max(0, p.onHand - exc.qty);
        p.damaged = Math.max(0, p.damaged - exc.qty);
      }
      if (action.optionId === "repick_other_bin" || action.optionId === "repick") {
        if (o) {
          o.status = "picking";
          o.stageEnteredAt = state.clock;
          o.lines = o.lines.map((l) => (l.sku === exc.sku ? { ...l, picked: Math.max(0, l.picked - exc.qty) } : l));
        }
      }
      if (action.optionId === "partial_ship" || action.optionId === "ship_partial") {
        if (o) {
          o.lines = o.lines.map((l) =>
            l.sku === exc.sku ? { ...l, qty: Math.max(l.allocated, l.qty - exc.qty) } : l,
          );
          o.backordered.push({ sku: exc.sku, qty: exc.qty });
        }
      }
      if (o) o.notes.push(`Exception ${exc.id}: ${option.label}.`);

      return log(
        {
          ...state,
          products,
          orders,
          exceptions: state.exceptions.map((e) =>
            e.id === action.id ? { ...e, status: "resolved", resolution: option.label } : e,
          ),
        },
        "decision",
        `Exception ${exc.id} resolved`,
        `${option.label} — ${option.detail}`,
        exc.orderId,
      );
    }

    case "receive_stock": {
      const next = {
        ...state,
        products: state.products.map((p) =>
          p.sku === action.sku
            ? { ...p, onHand: p.onHand + action.qty, inbound: Math.max(0, p.inbound - action.qty) }
            : p,
        ),
      };
      return log(next, "event", `Received ${action.qty} × ${action.sku}`, "Putaway complete — units are now allocatable.");
    }

    case "create_order":
      return log(
        { ...state, orders: [action.order, ...state.orders] },
        "event",
        `${action.order.id} created`,
        `${action.order.tier} order for ${action.order.customer} · ${action.order.lines.length} line(s).`,
        action.order.id,
      );

    case "tick": {
      const clock = new Date(new Date(state.clock).getTime() + action.hours * 3600_000).toISOString();
      return log({ ...state, clock }, "event", `Clock +${action.hours}h`, "Simulated shift time advanced — SLA scores recalculated.");
    }
  }
}

type Api = {
  state: WhState;
  runAllocation: (orderId?: string) => void;
  advance: (orderId: string) => void;
  assign: (orderId: string, picker: string) => void;
  expedite: (orderId: string) => void;
  reportException: (a: { orderId?: string; sku: string; qty: number; kind: ExceptionKind }) => void;
  resolveException: (id: string, optionId: string) => void;
  receiveStock: (sku: string, qty: number) => void;
  createOrder: (o: Order) => void;
  tick: (hours: number) => void;
  reset: () => void;
};

const Ctx = createContext<Api | null>(null);

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const hydrated = useRef(false);

  // Persist the simulated floor state so a refresh does not lose the shift.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) dispatch({ type: "restore", state: JSON.parse(raw) as WhState });
    } catch {
      /* ignore corrupt cache */
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }, [state]);

  const api = useMemo<Api>(
    () => ({
      state,
      runAllocation: (orderId) => dispatch({ type: "run_allocation", ...(orderId ? { orderId } : {}) }),
      advance: (orderId) => dispatch({ type: "advance", orderId }),
      assign: (orderId, picker) => dispatch({ type: "assign", orderId, picker }),
      expedite: (orderId) => dispatch({ type: "expedite", orderId }),
      reportException: (a) => dispatch({ type: "report_exception", ...a }),
      resolveException: (id, optionId) => dispatch({ type: "resolve_exception", id, optionId }),
      receiveStock: (sku, qty) => dispatch({ type: "receive_stock", sku, qty }),
      createOrder: (o) => dispatch({ type: "create_order", order: o }),
      tick: (hours) => dispatch({ type: "tick", hours }),
      reset: () => {
        try {
          window.localStorage.removeItem(KEY);
        } catch {
          /* ignore */
        }
        dispatch({ type: "reset" });
      },
    }),
    [state],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWarehouse() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWarehouse must be used inside WarehouseProvider");
  return ctx;
}

export function useScored() {
  const { state } = useWarehouse();
  return useCallback((o: Order) => scoreOrder(o, state.clock), [state.clock]);
}

export const freeStock = available;
