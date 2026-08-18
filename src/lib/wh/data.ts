import type { Order, Product, WhState } from "./types";

// Deterministic seed clock so SSR and client render identically.
export const T0 = new Date("2026-08-18T09:00:00.000Z");
const h = (n: number) => new Date(T0.getTime() + n * 3600_000).toISOString();

const P = (
  sku: string,
  name: string,
  category: string,
  zone: string,
  aisle: number,
  bin: string,
  onHand: number,
  reserved: number,
  reorderPoint: number,
  leadTimeDays: number,
  dailyVelocity: number,
  unitCost: number,
  inbound = 0,
  inboundEta?: string,
): Product => ({
  sku,
  name,
  category,
  zone,
  aisle,
  bin,
  onHand,
  reserved,
  damaged: 0,
  reorderPoint,
  leadTimeDays,
  dailyVelocity,
  unitCost,
  inbound,
  inboundEta,
});

export const seedProducts: Product[] = [
  P("SKU-1001", "Noise-Cancel Headphones X2", "Audio", "A", 1, "A1-03", 7, 0, 24, 5, 9.5, 82, 40, h(36)),
  P("SKU-1002", "USB-C 100W Cable 2m", "Cables", "A", 2, "A2-11", 260, 30, 80, 3, 26, 4.2),
  P("SKU-1003", "Mechanical Keyboard TKL", "Peripherals", "B", 4, "B4-07", 34, 6, 20, 7, 4.1, 58),
  P("SKU-1004", "4K Webcam Pro", "Video", "B", 5, "B5-02", 12, 4, 15, 10, 3.2, 74, 0),
  P("SKU-1005", "Ergo Mouse Silent", "Peripherals", "A", 3, "A3-09", 96, 12, 40, 4, 11.8, 19),
  P("SKU-1006", "27in QHD Monitor", "Displays", "D", 9, "D9-01", 18, 2, 12, 14, 2.4, 189),
  P("SKU-1007", "Laptop Stand Alu", "Accessories", "C", 6, "C6-04", 3, 0, 18, 6, 6.7, 23, 60, h(20)),
  P("SKU-1008", "Powerbank 20K mAh", "Power", "C", 7, "C7-12", 41, 9, 25, 5, 8.3, 27),
  P("SKU-1009", "Studio Mic Kit", "Audio", "D", 10, "D10-05", 9, 3, 8, 12, 1.6, 132),
  P("SKU-1010", "Cat6 Patch Cable 5m", "Cables", "A", 2, "A2-04", 480, 40, 120, 2, 33, 2.1),
  P("SKU-1011", "Docking Station 11-in-1", "Peripherals", "B", 5, "B5-14", 0, 0, 14, 9, 3.9, 96, 25, h(52)),
  P("SKU-1012", "Wireless Charger Duo", "Power", "C", 7, "C7-02", 63, 8, 30, 4, 9.1, 21),
];

const O = (
  id: string,
  customer: string,
  channel: Order["channel"],
  tier: Order["tier"],
  value: number,
  vip: boolean,
  createdH: number,
  promisedH: number,
  lines: [string, number][],
): Order => ({
  id,
  customer,
  channel,
  tier,
  value,
  vip,
  createdAt: h(createdH),
  promisedAt: h(promisedH),
  status: "new",
  lines: lines.map(([sku, qty]) => ({ sku, qty, allocated: 0, picked: 0, packed: 0 })),
  backordered: [],
  notes: [],
  stageEnteredAt: h(createdH),
});

export const seedOrders: Order[] = [
  O("ORD-4821", "Helix Medtech", "b2b", "express", 1840, true, -6, 4, [
    ["SKU-1001", 10],
    ["SKU-1002", 6],
  ]),
  O("ORD-4822", "R. Mehta", "web", "standard", 96, false, -5, 46, [["SKU-1001", 5]]),
  O("ORD-4823", "Northgate Retail", "retail", "priority", 2210, false, -4, 10, [
    ["SKU-1006", 6],
    ["SKU-1005", 12],
    ["SKU-1010", 20],
  ]),
  O("ORD-4824", "A. Fernandes", "marketplace", "express", 148, false, -3, 3, [
    ["SKU-1007", 2],
    ["SKU-1002", 1],
  ]),
  O("ORD-4825", "Bluewave Studios", "b2b", "priority", 1290, true, -3, 18, [
    ["SKU-1009", 4],
    ["SKU-1001", 2],
  ]),
  O("ORD-4826", "S. Iyer", "web", "standard", 64, false, -2, 60, [
    ["SKU-1012", 2],
    ["SKU-1010", 4],
  ]),
  O("ORD-4827", "Orbit Coworking", "b2b", "standard", 780, false, -2, 34, [
    ["SKU-1011", 6],
    ["SKU-1003", 4],
  ]),
  O("ORD-4828", "K. Tanaka", "web", "priority", 232, false, -1, 12, [
    ["SKU-1004", 3],
    ["SKU-1005", 1],
  ]),
  O("ORD-4829", "Vertex Labs", "b2b", "express", 3120, true, -1, 6, [
    ["SKU-1006", 8],
    ["SKU-1003", 6],
    ["SKU-1008", 10],
  ]),
  O("ORD-4830", "M. Okoro", "marketplace", "standard", 41, false, 0, 70, [["SKU-1002", 3]]),
];

export const initialState = (): WhState => ({
  products: seedProducts.map((p) => ({ ...p })),
  orders: seedOrders.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) })),
  exceptions: [],
  log: [
    {
      id: "LOG-0",
      at: T0.toISOString(),
      kind: "event",
      title: "Shift started",
      detail: "Day shift active · 4 pickers · 2 packing stations · 1 QC lane",
    },
  ],
  clock: T0.toISOString(),
});
