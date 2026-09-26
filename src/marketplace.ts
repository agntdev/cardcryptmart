import type { Ctx } from "./bot.js";

export type Condition = "New" | "Near Mint" | "Excellent" | "Good" | "Played" | "Poor";
export type Currency = "BTC" | "ETH" | "USDC";
export interface Listing {
  id: string; seller: number; title: string; condition: Condition; quantity: number;
  amount: string; currency: Currency; photos: string[]; description: string;
  shipping: string; status: "active" | "removed" | "sold"; created: string;
}
export interface Order {
  id: string; listingId: string; buyer: number; seller: number; amount: string;
  currency: Currency; address: string; proofs: string[];
  state: "awaiting_payment" | "paid" | "shipped" | "completed" | "cancelled" | "disputed";
}
export interface Rating { orderId: string; rater: number; score: number; note: string; }
export interface Report { id: string; reporter: number; target: string; reason: string; status: "open" | "resolved" | "closed"; created: string; }
export interface Profile { userId: number; displayName: string; created: string; }

type D1 = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> } } };
type EnvCtx = Ctx & { env?: { DB?: D1; ADMIN_CHAT_ID?: string | number } };

export function envOf(ctx: Ctx): EnvCtx["env"] {
  return (ctx as EnvCtx).env;
}

let clock: () => Date = () => new Date();
/** Test and Worker seam for all marketplace timestamps. */
export function setClock(next: () => Date): void { clock = next; }

function db(ctx: Ctx): D1 | undefined { return envOf(ctx)?.DB; }
function key(prefix: string, id: string): string { return `${prefix}:${id}`; }

export async function saveListing(ctx: Ctx, listing: Listing): Promise<void> {
  const store = db(ctx);
  if (store) {
    await store.prepare("CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, seller INTEGER, data TEXT)").bind().run();
    await store.prepare("INSERT OR REPLACE INTO listings (id,seller,data) VALUES (?,?,?)").bind(listing.id, listing.seller, JSON.stringify(listing)).run();
    return;
  }
  // The tokenless harness has no Worker binding. This keeps a draft available
  // for the current dialog; deployed data always takes the D1 branch above.
  ctx.session.draft = { ...(ctx.session.draft ?? {}), [key("listing", listing.id)]: listing };
}

export async function saveProfile(ctx: Ctx, profile: Profile): Promise<void> {
  const store = db(ctx);
  if (store) {
    await store.prepare("CREATE TABLE IF NOT EXISTS profiles (user_id INTEGER PRIMARY KEY, data TEXT)").bind().run();
    await store.prepare("INSERT OR REPLACE INTO profiles (user_id,data) VALUES (?,?)").bind(profile.userId, JSON.stringify(profile)).run();
  } else {
    ctx.session.draft = { ...(ctx.session.draft ?? {}), [key("profile", String(profile.userId))]: profile };
  }
}

export async function listListings(ctx: Ctx): Promise<Listing[]> {
  const store = db(ctx);
  if (store) {
    await store.prepare("CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, seller INTEGER, data TEXT)").bind().run();
    const rows = await store.prepare("SELECT data FROM listings WHERE json_extract(data,'$.status') = 'active' ORDER BY id DESC LIMIT 100").bind().all<{ data: string }>();
    return rows.results.map((r) => JSON.parse(r.data) as Listing);
  }
  const values = Object.values(ctx.session.draft ?? {});
  return values.filter((v): v is Listing => typeof v === "object" && v !== null && "title" in v && (v as Listing).status === "active");
}

export async function findListing(ctx: Ctx, id: string): Promise<Listing | undefined> {
  const all = await listListings(ctx);
  return all.find((item) => item.id === id);
}

export async function saveOrder(ctx: Ctx, order: Order): Promise<void> {
  const store = db(ctx);
  if (store) {
    await store.prepare("CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, buyer INTEGER, seller INTEGER, data TEXT)").bind().run();
    await store.prepare("INSERT OR REPLACE INTO orders (id,buyer,seller,data) VALUES (?,?,?,?)").bind(order.id, order.buyer, order.seller, JSON.stringify(order)).run();
    return;
  }
  ctx.session.draft = { ...(ctx.session.draft ?? {}), [key("order", order.id)]: order };
}

export async function saveReport(ctx: Ctx, report: Report): Promise<void> {
  const store = db(ctx);
  if (store) {
    await store.prepare("CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter INTEGER, data TEXT)").bind().run();
    await store.prepare("INSERT OR REPLACE INTO reports (id,reporter,data) VALUES (?,?,?)").bind(report.id, report.reporter, JSON.stringify(report)).run();
  } else {
    ctx.session.draft = { ...(ctx.session.draft ?? {}), [key("report", report.id)]: report };
  }
}

export async function saveRating(ctx: Ctx, rating: Rating): Promise<void> {
  const store = db(ctx);
  if (store) {
    await store.prepare("CREATE TABLE IF NOT EXISTS ratings (id TEXT PRIMARY KEY, rater INTEGER, data TEXT)").bind().run();
    await store.prepare("INSERT OR REPLACE INTO ratings (id,rater,data) VALUES (?,?,?)").bind(`${rating.orderId}:${rating.rater}`, rating.rater, JSON.stringify(rating)).run();
  } else {
    ctx.session.draft = { ...(ctx.session.draft ?? {}), [key("rating", `${rating.orderId}:${rating.rater}`)]: rating };
  }
}

export async function listOrders(ctx: Ctx): Promise<Order[]> {
  const store = db(ctx);
  if (store) {
    await store.prepare("CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, buyer INTEGER, seller INTEGER, data TEXT)").bind().run();
    const rows = await store.prepare("SELECT data FROM orders WHERE buyer = ? OR seller = ? ORDER BY id DESC LIMIT 100").bind(ctx.from?.id ?? 0, ctx.from?.id ?? 0).all<{ data: string }>();
    return rows.results.map((r) => JSON.parse(r.data) as Order);
  }
  const user = ctx.from?.id;
  return Object.values(ctx.session.draft ?? {}).filter((v): v is Order => typeof v === "object" && v !== null && "state" in v && ((v as Order).buyer === user || (v as Order).seller === user));
}

export async function notifyOwner(ctx: Ctx, text: string): Promise<boolean> {
  const owner = envOf(ctx)?.ADMIN_CHAT_ID ?? (typeof process !== "undefined" ? process.env.ADMIN_CHAT_ID : undefined);
  if (owner === undefined || owner === "") return false;
  try { await ctx.api.sendMessage(String(owner), text); return true; } catch { return false; }
}

export function newId(prefix: string, userId: number): string {
  return `${prefix}-${userId}-${now().replace(/\D/g, "").slice(-12)}`;
}

export function now(): string { return clock().toISOString(); }
