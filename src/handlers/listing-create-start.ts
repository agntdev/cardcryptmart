import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { newId, now, notifyOwner, saveListing, type Condition, type Currency } from "../marketplace.js";

registerMainMenuItem({ label: "Create listing", data: "listing:create:start", order: 10 });
const composer = new Composer<Ctx>();
const forceReply = { force_reply: true as const, input_field_placeholder: "Type your answer" };
const conditions: Condition[] = ["New", "Near Mint", "Excellent", "Good", "Played", "Poor"];

composer.callbackQuery("listing:create:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.flow = "listing:title";
  ctx.session.draft = { created: now(), photos: [] };
  await ctx.reply("Create listing — you're in the right place. What would you like to do next?");
  await ctx.reply("What card are you listing?", { reply_markup: forceReply });
});

composer.on("message:text", async (ctx, next) => {
  const flow = ctx.session.flow;
  const value = ctx.message.text.trim();
  if (!flow?.startsWith("listing:")) return next();
  if (flow === "listing:title") {
    if (value.length < 2 || value.length > 100) { await ctx.reply("Use a title between 2 and 100 characters.", { reply_markup: forceReply }); return; }
    ctx.session.draft = { ...(ctx.session.draft ?? {}), title: value };
    ctx.session.flow = "listing:condition";
    await ctx.reply("Choose the card condition.", { reply_markup: inlineKeyboard(conditions.map((c) => [inlineButton(c, `listing:condition:${c}`)])) });
    return;
  }
  if (flow === "listing:quantity") {
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) { await ctx.reply("Enter a whole quantity from 1 to 999.", { reply_markup: forceReply }); return; }
    ctx.session.draft = { ...(ctx.session.draft ?? {}), quantity };
    ctx.session.flow = "listing:amount";
    await ctx.reply("What is the price? Enter an amount, such as 0.05.", { reply_markup: forceReply });
    return;
  }
  if (flow === "listing:amount") {
    if (!/^\d+(\.\d{1,8})?$/.test(value) || Number(value) <= 0) { await ctx.reply("Enter a positive amount, using numbers only.", { reply_markup: forceReply }); return; }
    ctx.session.draft = { ...(ctx.session.draft ?? {}), amount: value };
    ctx.session.flow = "listing:crypto";
    await ctx.reply("Choose the payment currency.", { reply_markup: inlineKeyboard([[inlineButton("BTC", "listing:crypto:BTC"), inlineButton("ETH", "listing:crypto:ETH"), inlineButton("USDC", "listing:crypto:USDC")]]) });
    return;
  }
  if (flow === "listing:description") {
    ctx.session.draft = { ...(ctx.session.draft ?? {}), description: value === "-" ? "" : value };
    ctx.session.flow = "listing:shipping";
    await ctx.reply("Add shipping rules, or type - to skip.", { reply_markup: forceReply });
    return;
  }
  if (flow === "listing:shipping") {
    ctx.session.draft = { ...(ctx.session.draft ?? {}), shipping: value === "-" ? "" : value };
    ctx.session.flow = "listing:preview";
    await showPreview(ctx);
    return;
  }
  return next();
});

composer.callbackQuery(/^listing:condition:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const condition = ctx.match[1] as Condition;
  ctx.session.draft = { ...(ctx.session.draft ?? {}), condition };
  ctx.session.flow = "listing:quantity";
  await ctx.reply("How many cards are available?", { reply_markup: forceReply });
});

composer.callbackQuery(/^listing:crypto:(BTC|ETH|USDC)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.draft = { ...(ctx.session.draft ?? {}), currency: ctx.match[1] as Currency, photos: [] };
  ctx.session.flow = "listing:photos";
  await ctx.reply("Upload up to 6 card photos. When you're done, tap Skip photos.", { reply_markup: inlineKeyboard([[inlineButton("Skip photos", "listing:photos:done")]]) });
});

composer.on("message:photo", async (ctx, next) => {
  if (ctx.session.flow !== "listing:photos") return next();
  const photos = Array.isArray(ctx.session.draft?.photos) ? [...ctx.session.draft.photos as string[]] : [];
  if (photos.length >= 6) { await ctx.reply("You can add up to 6 photos. Tap Done to continue.", { reply_markup: inlineKeyboard([[inlineButton("Done", "listing:photos:done")]]) }); return; }
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  photos.push(photo.file_id);
  ctx.session.draft = { ...(ctx.session.draft ?? {}), photos };
  await ctx.reply(`${photos.length} of 6 photos added.`, { reply_markup: inlineKeyboard([[inlineButton("Done", "listing:photos:done")]]) });
});

composer.callbackQuery("listing:photos:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.flow = "listing:description";
  await ctx.reply("Add a short description, or type - to skip.", { reply_markup: forceReply });
});

composer.callbackQuery("listing:publish", async (ctx) => {
  await ctx.answerCallbackQuery();
  const d = ctx.session.draft ?? {};
  if (!ctx.from || typeof d.title !== "string" || typeof d.condition !== "string" || typeof d.quantity !== "number" || typeof d.amount !== "string" || typeof d.currency !== "string") {
    await ctx.reply("This listing is missing details. Tap Create listing to start again."); return;
  }
  const listing = { id: newId("listing", ctx.from.id), seller: ctx.from.id, title: d.title, condition: d.condition as Condition, quantity: d.quantity, amount: d.amount, currency: d.currency as Currency, photos: Array.isArray(d.photos) ? d.photos as string[] : [], description: typeof d.description === "string" ? d.description : "", shipping: typeof d.shipping === "string" ? d.shipping : "", status: "active" as const, created: typeof d.created === "string" ? d.created : now() };
  await saveListing(ctx, listing);
  ctx.session.flow = undefined;
  await ctx.reply(`Your listing is live: ${listing.title} — ${listing.amount} ${listing.currency}.`);
  if (Number(listing.amount) >= 1000) await notifyOwner(ctx, `High-value listing: ${listing.title} (${listing.amount} ${listing.currency}).`);
});

async function showPreview(ctx: Ctx): Promise<void> {
  const d = ctx.session.draft ?? {};
  await ctx.reply(`Preview\n${String(d.title)}\nCondition: ${String(d.condition)}\nQuantity: ${String(d.quantity)}\nPrice: ${String(d.amount)} ${String(d.currency)}\nPhotos: ${Array.isArray(d.photos) ? d.photos.length : 0}`, { reply_markup: inlineKeyboard([[inlineButton("Publish listing", "listing:publish")], [inlineButton("Start again", "listing:create:start")]]) });
}

export default composer;
