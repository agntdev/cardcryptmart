import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { now, saveProfile } from "../marketplace.js";

registerMainMenuItem({ label: "Create profile", data: "profile:create", order: 40 });
const composer = new Composer<Ctx>();

composer.callbackQuery("profile:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.flow = "profile:name";
  await ctx.reply("What display name should collectors see?", { reply_markup: { force_reply: true, input_field_placeholder: "Your display name" } });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.flow !== "profile:name") return next();
  const name = ctx.message.text.trim();
  if (name.length < 2 || name.length > 60) { await ctx.reply("Use a display name between 2 and 60 characters."); return; }
  await saveProfile(ctx, { userId: ctx.from?.id ?? 0, displayName: name, created: now() });
  ctx.session.flow = undefined;
  await ctx.reply(`Your profile is ready, ${name}. We never ask for private keys or wallet recovery phrases.`, { reply_markup: inlineKeyboard([[inlineButton("Browse listings", "browse:start"), inlineButton("Create listing", "listing:create:start")]]) });
});

export default composer;
