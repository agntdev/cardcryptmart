import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { listOrders, newId, notifyOwner, saveOrder, saveRating, type Order } from "../marketplace.js";

registerMainMenuItem({ label: "My orders", data: "orders:my", order: 30 });
const composer = new Composer<Ctx>();
const forceReply = { force_reply: true as const, input_field_placeholder: "Paste a transaction hash or explain the issue" };

composer.callbackQuery("orders:my", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("My orders — you're in the right place. What would you like to do next?");
  const orders = await listOrders(ctx);
  if (orders.length === 0) { await ctx.reply("No orders yet — browse listings when you're ready to buy.", { reply_markup: inlineKeyboard([[inlineButton("Browse listings", "browse:start")]]) }); return; }
  for (const order of orders) await sendOrder(ctx, order);
});

composer.callbackQuery(/^order:view:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const order = (await listOrders(ctx)).find((o) => o.id === ctx.match[1]);
  if (!order) { await ctx.reply("That order isn't available here."); return; }
  await sendOrder(ctx, order);
});

composer.callbackQuery(/^order:proof:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.flow = `order:proof:${ctx.match[1]}`;
  await ctx.reply("Upload a payment screenshot or paste the transaction hash.", { reply_markup: forceReply });
});

composer.on("message:photo", async (ctx, next) => {
  if (!ctx.session.flow?.startsWith("order:proof:")) return next();
  const id = ctx.session.flow.slice("order:proof:".length);
  const order = (await listOrders(ctx)).find((o) => o.id === id);
  if (!order) { await ctx.reply("That order isn't available here."); return; }
  order.proofs.push(ctx.message.photo.at(-1)?.file_id ?? "photo");
  await saveOrder(ctx, order);
  ctx.session.flow = undefined;
  await ctx.reply("Payment proof received. The seller must verify it before shipping.");
  await notifyOwner(ctx, `Payment proof submitted for order ${order.id}.`);
});

composer.on("message:text", async (ctx, next) => {
  if (!ctx.session.flow?.startsWith("order:proof:")) return next();
  const id = ctx.session.flow.slice("order:proof:".length);
  const order = (await listOrders(ctx)).find((o) => o.id === id);
  if (!order) { await ctx.reply("That order isn't available here."); return; }
  const proof = ctx.message.text.trim();
  if (proof.length < 6 || proof.length > 300) { await ctx.reply("That proof is too short. Paste the transaction hash or upload a screenshot.", { reply_markup: forceReply }); return; }
  order.proofs.push(proof);
  await saveOrder(ctx, order);
  ctx.session.flow = undefined;
  await ctx.reply("Payment proof received. The seller must verify it before shipping.");
  await notifyOwner(ctx, `Payment proof submitted for order ${order.id}.`);
});

composer.callbackQuery(/^order:paid:(.+)$/, async (ctx) => updateState(ctx, ctx.match[1], "paid", "Payment marked as verified. The seller can now ship the card."));
composer.callbackQuery(/^order:shipped:(.+)$/, async (ctx) => updateState(ctx, ctx.match[1], "shipped", "Shipment marked. Ask the buyer to confirm receipt when it arrives."));
composer.callbackQuery(/^order:received:(.+)$/, async (ctx) => updateState(ctx, ctx.match[1], "completed", "Receipt confirmed. Please rate the other party.", true));

composer.callbackQuery(/^order:dispute:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const order = (await listOrders(ctx)).find((o) => o.id === ctx.match[1]);
  if (!order) { await ctx.reply("That order isn't available here."); return; }
  order.state = "disputed"; await saveOrder(ctx, order);
  await ctx.reply("The order is on hold. Explain what happened and the owner will review it.", { reply_markup: inlineKeyboard([[inlineButton("Send details", `order:report:${order.id}`)]]) });
  const sent = await notifyOwner(ctx, `Dispute opened for order ${order.id}. Use the owner controls to review it.`);
  if (!sent && adminChatId(ctx as any) === undefined) await ctx.reply("Owner access isn't set up yet.");
});

composer.callbackQuery(/^order:report:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.flow = `order:report:${ctx.match[1]}`;
  await ctx.reply("What happened? Keep the explanation factual and concise.", { reply_markup: forceReply });
});

composer.on("message:text", async (ctx, next) => {
  if (!ctx.session.flow?.startsWith("order:report:")) return next();
  const id = ctx.session.flow.slice("order:report:".length);
  ctx.session.flow = undefined;
  const sent = await notifyOwner(ctx, `Order report ${id}: ${ctx.message.text.trim()}`);
  await ctx.reply(sent ? "Your report was sent to the owner." : "Your report is saved, but owner access isn't set up yet.");
});

composer.callbackQuery(/^order:rate:(.+):(\d)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const score = Number(ctx.match[2]);
  await saveRating(ctx, { orderId: ctx.match[1], rater: ctx.from?.id ?? 0, score, note: "" });
  await ctx.reply(`Thanks for the ${score}-star rating. Your feedback helps collectors trade with confidence.`);
});

async function updateState(ctx: Ctx, id: string, state: Order["state"], message: string, rating = false): Promise<void> {
  await ctx.answerCallbackQuery();
  const order = (await listOrders(ctx)).find((o) => o.id === id);
  if (!order) { await ctx.reply("That order isn't available here."); return; }
  const user = ctx.from?.id;
  if ((state === "paid" || state === "shipped") && order.seller !== user) { await ctx.reply("Only the seller can update this step."); return; }
  if (state === "completed" && order.buyer !== user) { await ctx.reply("Only the buyer can confirm receipt."); return; }
  order.state = state; await saveOrder(ctx, order); await ctx.reply(message);
  if (rating) await ctx.reply("Rate the seller.", { reply_markup: inlineKeyboard([[1, 2, 3, 4, 5].map((n) => inlineButton(`${n} star${n === 1 ? "" : "s"}`, `order:rate:${id}:${n}`))]) });
}

async function sendOrder(ctx: Ctx, order: Order): Promise<void> {
  const controls = order.state === "awaiting_payment" ? [inlineButton("Upload proof", `order:proof:${order.id}`), inlineButton("Raise dispute", `order:dispute:${order.id}`)] : order.state === "paid" && order.seller === ctx.from?.id ? [inlineButton("Mark shipped", `order:shipped:${order.id}`)] : order.state === "shipped" && order.buyer === ctx.from?.id ? [inlineButton("Confirm receipt", `order:received:${order.id}`)] : [];
  await ctx.reply(`Order ${order.id}\nStatus: ${order.state}\nAmount: ${order.amount} ${order.currency}`, { reply_markup: inlineKeyboard(controls.length ? [controls] : [[inlineButton("Raise dispute", `order:dispute:${order.id}`)]]) });
}

export default composer;
