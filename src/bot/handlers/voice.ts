import type { Context } from "grammy";
import type { Config } from "../../config";
import { transcribeAudio } from "../../stt/parakeet";
import { getSessionKey } from "../session";
import type { Debouncer } from "../middleware/debounce";
import { mkdirSync, unlinkSync } from "fs";
import { join } from "path";

const TMP = join(import.meta.dir, "../../.tmp");
mkdirSync(TMP, { recursive: true });

export function createVoiceHandler(
  config: Config,
  debouncer: Debouncer,
  ctxMap: Map<string, Context>
) {
  return async (ctx: Context): Promise<void> => {
    const voice = ctx.message?.voice;
    if (!voice) return;
    const key = getSessionKey(ctx);
    ctxMap.set(key, ctx);

    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const buf = await (await fetch(url)).arrayBuffer();

      const ogg = join(TMP, `${voice.file_unique_id}.ogg`);
      const wav = join(TMP, `${voice.file_unique_id}.wav`);
      await Bun.write(ogg, buf);

      // Convert OGG to WAV 16kHz mono using Bun.spawn
      const ffmpeg = Bun.spawn({
        cmd: ["ffmpeg", "-loglevel", "error", "-y", "-i", ogg, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
      });
      await ffmpeg.exited;

      const transcript = await transcribeAudio(wav, config.parakeetUrl);

      // Show italic transcript
      const threadId = (ctx.message as any)?.message_thread_id;
      const opts: any = { parse_mode: "Markdown" };
      if (threadId && threadId !== 1) opts.message_thread_id = threadId;
      await ctx.api.sendMessage(ctx.chat!.id, `_${transcript}_`, opts);

      debouncer.add(key, transcript);

      try { unlinkSync(ogg); unlinkSync(wav); } catch {}
    } catch (err) {
      console.error("Voice error:", err);
      await ctx.reply("Could not process voice message.");
    }
  };
}
