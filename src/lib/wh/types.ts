export type Tier = "express" | "priority" | "standard";

export type OrderStatus =
  | "new"
  | "awaiting_stock"
  | "allocated"
  | "picking"
  | "packing"
  | "qc"
  | "dispatched"
  | "cancelled";

export const STAGE_FLOW: OrderStatus[] = [
  "new",
  "allocated",
  "picking",
  "packing",
  "qc",
  "dispatched",
];

export type Product = {
  sku: string;
  name: string;
  category: string;
  zone: string;
  aisle: number;
  bin: string;
  onHand: number;
  reserved: number;
  damaged: number;
  reorderPoint: number;
  leadTimeDays: number;
  dailyVelocity: number;
  unitCost: number;
  inbound: number;
  inboundEta?: string | undefined;
};

export type OrderLine = {
  sku: string;
  qty: number;
  allocated: number;
  picked: number;
  packed: number;
};

export type Order = {
  id: string;
  customer: string;
  channel: "web" | "retail" | "b2b" | "marketplace";
  tier: Tier;
  value: number;
  vip: boolean;
  createdAt: string;
  promisedAt: string;
  status: OrderStatus;
  lines: OrderLine[];
  backordered: { sku: string; qty: number }[];
  notes: string[];
  splitFrom?: string | undefined;
  stageEnteredAt: string;
  assignedTo?: string | undefined;
};

export type ExceptionKind = "damaged" | "missing" | "shortfall" | "qc_fail";

export type WhException = {
  id: string;
  kind: ExceptionKind;
  orderId?: string | undefined;
  sku: string;
  qty: number;
  detectedAt: string;
  status: "open" | "resolved";
  detail: string;
  resolution?: string | undefined;
  options: { id: string; label: string; detail: string; recommended?: boolean | undefined }[];
};

export type LogEntry = {
  id: string;
  at: string;
  kind: "decision" | "event" | "exception";
  title: string;
  detail: string;
  orderId?: string | undefined;
};

export type WhState = {
  products: Product[];
  orders: Order[];
  exceptions: WhException[];
  log: LogEntry[];
  clock: string;
};

export const available = (p: Product) => Math.max(0, p.onHand - p.reserved);
export const daysOfCover = (p: Product) =>
  p.dailyVelocity > 0 ? +(available(p) / p.dailyVelocity).toFixed(1) : 99;
export const stockState = (p: Product): "out" | "low" | "watch" | "healthy" => {
  const a = available(p);
  if (a <= 0) return "out";
  if (a <= p.reorderPoint * 0.5) return "low";
  if (a <= p.reorderPoint) return "watch";
  return "healthy";
};
