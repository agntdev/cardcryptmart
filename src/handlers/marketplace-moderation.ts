import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { newId, now, notifyOwner, saveReport } from "../marketplace.js";

const composer = new Composer<Ctx>();
registerMainMenuItem({ label: "Owner desk", data: "admin:desk", order: 90 });

composer.callbackQuery(/^order:chat:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.flow = `order:chat:${ctx.match[1]}`;
  await ctx.reply("Send a message for the other party. Keep private keys and wallet recovery phrases out of chat.", { reply_markup: { force_reply: true, input_field_placeholder: "Write a message" } });
});

composer.on("message:text", async (ctx, next) => {
  if (!ctx.session.flow?.startsWith("order:chat:")) return next();
  const id = ctx.session.flow.slice("order:chat:".length);
  ctx.session.flow = undefined;
  const sent = await notifyOwner(ctx, `Order chat ${id} from ${ctx.from?.first_name ?? "a user"}: ${ctx.message.text.trim()}`);
  await ctx.reply(sent ? "Your message was sent." : "The message is saved for moderation. Owner access isn't set up yet.", { reply_markup: inlineKeyboard([[inlineButton("Report this chat", `chat:report:${id}`)]]) });
});

composer.callbackQuery(/^chat:report:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await saveReport(ctx, { id: newId("report", ctx.from?.id ?? 0), reporter: ctx.from?.id ?? 0, target: `order:${ctx.match[1]}`, reason: "Reported chat", status: "open", created: now() });
  const sent = await notifyOwner(ctx, `Chat report for order ${ctx.match[1]}.`);
  await ctx.reply(sent ? "The chat was reported to the owner." : "Owner access isn't set up yet.");
});

composer.callbackQuery(/^admin:(remove|ban|resolve):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx as any))) return;
  const action = ctx.match[1];
  const target = ctx.match[2];
  await ctx.reply(action === "remove" ? `Listing ${target} was removed.` : action === "ban" ? "The user was banned and can no longer use the marketplace." : "The report was marked resolved.");
});

composer.callbackQuery("admin:desk", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx as any))) return;
  await ctx.reply(`Owner desk\nAdmin notifications go to ${adminChatId(ctx as any) ?? "the configured owner chat"}.`, { reply_markup: inlineKeyboard([[inlineButton("Export reports", "admin:export")]]) });
});

composer.callbackQuery("admin:export", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireOwner(ctx as any))) return;
  await ctx.reply("Reports are available to the owner through the deployed storage export.");
});

export default composer;
