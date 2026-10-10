import type { Context } from "grammy";
import type { Config } from "../../config";
import { getSessionKey } from "../session";
import type { Debouncer } from "../middleware/debounce";
import { buildPrompt } from "../context-builder";
import {
  downloadFile,
  extractAudioWav,
  extractVideoFrames,
  FileTooBigError,
  formatSize,
  probeDuration,
} from "../media";
import { transcribeAudio } from "../../stt/parakeet";
import { mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { DEFAULT_PERSONA, type Persona } from "../../persona";

const MEDIA_DIR = "media";

interface Attachment {
  fileUniqueId: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  defaultExt: string;
  isVideo: boolean;
}

// Everything that isn't a photo or voice note: files, videos, audio, GIFs,
// round video notes. Telegram sends a video either as `video` or, when sent
// "as file", as `document` — both land here.
function getAttachment(ctx: Context): Attachment | null {
  const m = ctx.message;
  if (!m) return null;
  const f = m.document ?? m.video ?? m.audio ?? m.animation ?? m.video_note;
  if (!f) return null;
  const defaultExt = m.document ? "bin" : m.audio ? "mp3" : "mp4";
  const mimeType = "mime_type" in f ? f.mime_type : undefined;
  return {
    fileUniqueId: f.file_unique_id,
    fileName: "file_name" in f ? f.file_name : undefined,
    mimeType,
    fileSize: f.file_size,
    defaultExt,
    isVideo: Boolean(m.video ?? m.animation ?? m.video_note) || Boolean(mimeType?.startsWith("video/")),
  };
}

// Frames + optional transcript so Claude can actually "watch" the video.
// Failures here shouldn't lose the file itself, so they only add a note.
async function describeVideo(config: Config, videoPath: string, id: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    const duration = await probeDuration(videoPath);
    const frames = await extractVideoFrames(videoPath, join(config.workspacePath, MEDIA_DIR, `${id}_frames`), duration);
    lines.push(
      `[Video: ${duration.toFixed(0)}s. You can't open the video itself — read these ${frames.length} evenly spaced frames instead:]`,
      ...frames,
    );
  } catch (err) {
    console.error("Video frames error:", err);
    lines.push("[Couldn't extract frames from the video]");
  }

  const wav = join(config.workspacePath, MEDIA_DIR, `${id}.wav`);
  try {
    await extractAudioWav(videoPath, wav);
    const transcript = await transcribeAudio(wav, config.parakeetUrl);
    if (transcript) lines.push(`[Audio transcript:]\n${transcript}`);
  } catch (err) {
    // No audio track or STT is down — frames are still useful on their own.
    console.error("Video audio skipped:", err instanceof Error ? err.message : err);
  } finally {
    try { unlinkSync(wav); } catch {}
  }
  return lines;
}

function extFor(a: Attachment): string {
  const fromName = a.fileName?.includes(".") ? a.fileName.split(".").pop() : undefined;
  const fromMime = a.mimeType?.split("/")[1]?.replace("quicktime", "mov");
  return fromName ?? fromMime ?? a.defaultExt;
}

export function createPhotoHandler(
  config: Config,
  debouncer: Debouncer,
  ctxMap: Map<string, Context>,
  persona?: Persona,
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

      await downloadFile(ctx, config, dest, largest.file_size);

      const caption = ctx.message?.caption ?? "";
      const absPath = dest;
      const parts = [`[Photo attached: ${absPath}]`];
      if (caption) parts.push(caption);

      debouncer.add(key, buildPrompt(ctx, parts.join("\n")));
    } catch (err) {
      console.error("Photo error:", err);
      await ctx.reply(persona?.replies.photoError ?? DEFAULT_PERSONA.replies.photoError);
    }
  };
}

export function createDocumentHandler(
  config: Config,
  debouncer: Debouncer,
  ctxMap: Map<string, Context>,
  persona?: Persona,
) {
  const mediaPath = join(config.workspacePath, MEDIA_DIR);
  mkdirSync(mediaPath, { recursive: true });

  return async (ctx: Context): Promise<void> => {
    const att = getAttachment(ctx);
    if (!att) return;
    const key = getSessionKey(ctx);
    ctxMap.set(key, ctx);

    try {
      const filename = `${att.fileUniqueId}.${extFor(att)}`;
      const dest = join(mediaPath, filename);

      await downloadFile(ctx, config, dest, att.fileSize);

      const caption = ctx.message?.caption ?? "";
      const label = att.fileName
        ? `[File attached: ${dest} (${att.fileName})]`
        : `[File attached: ${dest}]`;
      const parts = [label];
      if (att.isVideo) parts.push(...(await describeVideo(config, dest, att.fileUniqueId)));
      if (caption) parts.push(caption);

      debouncer.add(key, buildPrompt(ctx, parts.join("\n")));
    } catch (err) {
      console.error("Document error:", err);
      if (err instanceof FileTooBigError) {
        await ctx.reply(
          `Файл весит ${formatSize(err.size)}, а Telegram отдаёт ботам максимум 20 MB. ` +
            "Сожми его или пришли ссылкой (Google Drive, Dropbox и т.п.).",
        );
        return;
      }
      await ctx.reply(persona?.replies.documentError ?? DEFAULT_PERSONA.replies.documentError);
    }
  };
}
