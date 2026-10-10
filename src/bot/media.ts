import type { Context } from "grammy";
import { copyFileSync, mkdirSync, readdirSync } from "fs";
import { isAbsolute, join } from "path";
import type { Config } from "../config";

// Cloud Bot API refuses getFile above 20 MB. A self-hosted telegram-bot-api
// server running with --local has no such limit.
export const CLOUD_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

export class FileTooBigError extends Error {
  constructor(readonly size: number) {
    super(`File is ${formatSize(size)}, Bot API download limit is ${formatSize(CLOUD_DOWNLOAD_LIMIT)}`);
  }
}

export function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function isCloudApi(config: Config): boolean {
  return new URL(config.telegramApiRoot).hostname === "api.telegram.org";
}

export async function downloadFile(
  ctx: Context,
  config: Config,
  destPath: string,
  size?: number,
): Promise<void> {
  if (size && size > CLOUD_DOWNLOAD_LIMIT && isCloudApi(config)) {
    throw new FileTooBigError(size);
  }

  const file = await ctx.getFile();
  if (!file.file_path) throw new Error("getFile returned no file_path");

  // Local Bot API server in --local mode returns an absolute path on disk.
  if (isAbsolute(file.file_path)) {
    copyFileSync(file.file_path, destPath);
    return;
  }

  const url = `${config.telegramApiRoot}/file/bot${config.telegramBotToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`File download failed: ${res.status} ${res.statusText}`);
  await Bun.write(destPath, res);
}

const MAX_FRAMES = 12;

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd[0]} exited ${code}: ${err.trim()}`);
  return out;
}

export async function probeDuration(videoPath: string): Promise<number> {
  const out = await run([
    "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath,
  ]);
  return Number.parseFloat(out) || 0;
}

// Claude can read images but not video, so turn a video into evenly spaced
// stills it can look at.
export async function extractVideoFrames(
  videoPath: string,
  outDir: string,
  duration: number,
): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const count = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(duration / 5)));
  const fps = duration > 0 ? count / duration : 1;
  await run([
    "ffmpeg", "-loglevel", "error", "-y", "-i", videoPath,
    "-vf", `fps=${fps},scale='min(768,iw)':-2`,
    "-frames:v", String(count), "-q:v", "4",
    join(outDir, "frame_%02d.jpg"),
  ]);
  return readdirSync(outDir)
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f) => join(outDir, f));
}

export async function extractAudioWav(videoPath: string, wavPath: string): Promise<void> {
  await run([
    "ffmpeg", "-loglevel", "error", "-y", "-i", videoPath, "-vn",
    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath,
  ]);
}
