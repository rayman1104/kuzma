import type { Context } from "grammy";
import type { Config } from "../../config";
import { transcribeAudio } from "../../stt/parakeet";
import { getSessionKey } from "../session";
import type { Debouncer } from "../middleware/debounce";
import { buildPrompt } from "../context-builder";
import { downloadFile } from "../media";
import { mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { DEFAULT_PERSONA, type Persona } from "../../persona";

const TMP = join(import.meta.dir, "../../.tmp");
mkdirSync(TMP, { recursive: true });

export function createVoiceHandler(
  config: Config,
  debouncer: Debouncer,
  ctxMap: Map<string, Context>,
  persona?: Persona,
) {
  return async (ctx: Context): Promise<void> => {
    const voice = ctx.message?.voice;
    if (!voice) return;
    const key = getSessionKey(ctx);
    ctxMap.set(key, ctx);

    try {
      const ogg = join(TMP, `${voice.file_unique_id}.ogg`);
      const wav = join(TMP, `${voice.file_unique_id}.wav`);
      await downloadFile(ctx, config, ogg, voice.file_size);

      // Convert OGG to WAV 16kHz mono using Bun.spawn
      const ffmpeg = Bun.spawn({
        cmd: ["ffmpeg", "-loglevel", "error", "-y", "-i", ogg, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
      });
      await ffmpeg.exited;

      const transcript = await transcribeAudio(wav, config.parakeetUrl);
      if (!transcript) return;

      // Show italic transcript
      const threadId = (ctx.message as any)?.message_thread_id;
      const opts: any = { parse_mode: "Markdown" };
      if (threadId && threadId !== 1) opts.message_thread_id = threadId;
      await ctx.api.sendMessage(ctx.chat!.id, `_${transcript}_`, opts);

      // Label voice message with forward metadata if present
      const origin = ctx.message?.forward_origin;
      let voiceLabel: string;
      if (origin) {
        const name =
          origin.type === "user"
            ? [origin.sender_user.first_name, origin.sender_user.last_name].filter(Boolean).join(" ")
            : origin.type === "hidden_user"
              ? origin.sender_user_name
              : undefined;
        voiceLabel = name
          ? `[Forwarded voice from: ${name}]`
          : "[Forwarded voice message]";
      } else {
        voiceLabel = "[Voice message]";
      }

      const labeled = `${voiceLabel}\n${transcript}`;
      debouncer.add(key, buildPrompt(ctx, labeled));

      try { unlinkSync(ogg); unlinkSync(wav); } catch {}
    } catch (err) {
      console.error("Voice error:", err);
      await ctx.reply(persona?.replies.voiceError ?? DEFAULT_PERSONA.replies.voiceError);
    }
  };
}
