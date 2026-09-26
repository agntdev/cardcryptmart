import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { findListing, listListings, newId, now, notifyOwner, saveOrder, type Listing, type Order } from "../marketplace.js";

registerMainMenuItem({ label: "Browse listings", data: "browse:start", order: 20 });
const composer = new Composer<Ctx>();

composer.callbackQuery("browse:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Browse listings — you're in the right place. What would you like to do next?");
  await ctx.reply("Choose a filter or view all active listings.", { reply_markup: inlineKeyboard([[inlineButton("Filter listings", "browse:filters")]]) });
  await showPage(ctx, 0);
});

composer.callbackQuery(/^browse:page:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPage(ctx, Number(ctx.match[1]));
});

composer.callbackQuery(/^browse:filter:(condition|crypto):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.draft = { ...(ctx.session.draft ?? {}), browseFilter: `${ctx.match[1]}:${ctx.match[2]}` };
  await showPage(ctx, 0);
});

composer.callbackQuery("browse:filters", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Filter by condition or currency.", { reply_markup: inlineKeyboard([[inlineButton("Near Mint", "browse:filter:condition:Near Mint"), inlineButton("Played", "browse:filter:condition:Played")], [inlineButton("BTC", "browse:filter:crypto:BTC"), inlineButton("ETH", "browse:filter:crypto:ETH"), inlineButton("USDC", "browse:filter:crypto:USDC")]]) });
});

composer.callbackQuery(/^listing:view:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const listing = await findListing(ctx, ctx.match[1]);
  if (!listing) { await ctx.reply("That listing is no longer available."); return; }
  await showListing(ctx, listing);
});

composer.callbackQuery(/^listing:buy:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const listing = await findListing(ctx, ctx.match[1]);
  if (!listing || listing.status !== "active") { await ctx.reply("That listing is no longer available."); return; }
  if (listing.seller === ctx.from?.id) { await ctx.reply("You can't buy your own listing."); return; }
  const order: Order = { id: newId("order", ctx.from?.id ?? 0), listingId: listing.id, buyer: ctx.from?.id ?? 0, seller: listing.seller, amount: listing.amount, currency: listing.currency, address: `pending-${newId("payment", ctx.from?.id ?? 0)}`, proofs: [], state: "awaiting_payment" };
  await saveOrder(ctx, order);
  ctx.session.activeOrderId = order.id;
  await ctx.reply(`Order started. Send ${order.amount} ${order.currency} to this one-time address:\n${order.address}\n\nOnly send this exact amount. Upload your payment proof after sending.`, { reply_markup: inlineKeyboard([[inlineButton("Upload payment proof", `order:proof:${order.id}`)], [inlineButton("Raise dispute", `order:dispute:${order.id}`)]]) });
  try { await ctx.api.sendMessage(String(order.seller), `A buyer started an order for ${listing.title}. Check My orders to review it.`); } catch { /* seller may not have a reachable chat */ }
});

composer.callbackQuery(/^listing:contact:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Open an order to contact the seller. Keep payment and chat inside this bot for your protection.");
});

composer.callbackQuery(/^listing:offer:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Offers aren't available for this listing yet. You can use Buy now for the listed price.");
});

async function showPage(ctx: Ctx, page: number): Promise<void> {
  const filter = typeof ctx.session.draft?.browseFilter === "string" ? ctx.session.draft.browseFilter : "";
  const listings = (await listListings(ctx)).filter((item) => !filter || (filter.startsWith("condition:") ? item.condition === filter.slice(10) : item.currency === filter.slice(7)));
  if (listings.length === 0) { await ctx.reply("No listings yet — tap Create listing to add the first card.", { reply_markup: inlineKeyboard([[inlineButton("Create listing", "listing:create:start")]]) }); return; }
  const start = Math.max(0, page) * 10;
  const items = listings.slice(start, start + 10);
  for (const listing of items) await ctx.reply(card(listing), { reply_markup: inlineKeyboard([[inlineButton("View", `listing:view:${listing.id}`), inlineButton("Buy now", `listing:buy:${listing.id}`)]]) });
  const controls = [];
  if (start > 0) controls.push(inlineButton("Previous", `browse:page:${page - 1}`));
  if (start + 10 < listings.length) controls.push(inlineButton("Next", `browse:page:${page + 1}`));
  if (controls.length) await ctx.reply("More listings", { reply_markup: inlineKeyboard([controls]) });
}

function card(listing: Listing): string { return `${listing.title}\n${listing.condition} · ${listing.amount} ${listing.currency}\n${listing.quantity} available`; }
async function showListing(ctx: Ctx, listing: Listing): Promise<void> {
  await ctx.reply(`${card(listing)}\n\n${listing.description || "No description provided."}\nPhotos: ${listing.photos.length}`, { reply_markup: inlineKeyboard([[inlineButton("Buy now", `listing:buy:${listing.id}`), inlineButton("Make offer", `listing:offer:${listing.id}`)], [inlineButton("Contact seller", `listing:contact:${listing.id}`)]]) });
}

export default composer;
