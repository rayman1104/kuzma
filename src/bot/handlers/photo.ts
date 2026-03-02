import type { Context } from "grammy";
import type { Config } from "../../config";
import { getSessionKey } from "../session";
import type { Debouncer } from "../middleware/debounce";
import { buildPrompt } from "../context-builder";
import { mkdirSync } from "fs";
import { join } from "path";

const MEDIA_DIR = "media";

async function downloadFile(
  ctx: Context,
  token: string,
  destPath: string,
): Promise<void> {
  const file = await ctx.getFile();
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const buf = await (await fetch(url)).arrayBuffer();
  await Bun.write(destPath, buf);
}

export function createPhotoHandler(
  config: Config,
  debouncer: Debouncer,
  ctxMap: Map<string, Context>,
) {
  const mediaPath = join(config.workspacePath, MEDIA_DIR);
  mkdirSync(mediaPath, { recursive: true });

  return async (ctx: Context): Promise<void> => {
    const photo = ctx.message?.photo;
    if (!photo?.length) return;
    const key = getSessionKey(ctx);
    ctxMap.set(key, ctx);

    try {
      const largest = photo[photo.length - 1];
      const ext = "jpg";
      const filename = `${largest.file_unique_id}.${ext}`;
      const dest = join(mediaPath, filename);

      await downloadFile(ctx, config.telegramBotToken, dest);

      const caption = ctx.message?.caption ?? "";
      const absPath = dest;
      const parts = [`[Photo attached: ${absPath}]`];
      if (caption) parts.push(caption);

      debouncer.add(key, buildPrompt(ctx, parts.join("\n")));
    } catch (err) {
      console.error("Photo error:", err);
      await ctx.reply("Не разглядел, скинь ещё раз.");
    }
  };
}

export function createDocumentHandler(
  config: Config,
  debouncer: Debouncer,
  ctxMap: Map<string, Context>,
) {
  const mediaPath = join(config.workspacePath, MEDIA_DIR);
  mkdirSync(mediaPath, { recursive: true });

  return async (ctx: Context): Promise<void> => {
    const doc = ctx.message?.document;
    if (!doc) return;
    const key = getSessionKey(ctx);
    ctxMap.set(key, ctx);

    try {
      const ext = doc.file_name?.split(".").pop() ?? "bin";
      const filename = `${doc.file_unique_id}.${ext}`;
      const dest = join(mediaPath, filename);

      await downloadFile(ctx, config.telegramBotToken, dest);

      const caption = ctx.message?.caption ?? "";
      const label = doc.file_name
        ? `[File attached: ${dest} (${doc.file_name})]`
        : `[File attached: ${dest}]`;
      const parts = [label];
      if (caption) parts.push(caption);

      debouncer.add(key, buildPrompt(ctx, parts.join("\n")));
    } catch (err) {
      console.error("Document error:", err);
      await ctx.reply("Не открылось, попробуй ещё.");
    }
  };
}
