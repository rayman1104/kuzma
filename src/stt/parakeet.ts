export async function transcribeAudio(wavPath: string, apiUrl: string): Promise<string> {
  const form = new FormData();
  form.append("file", Bun.file(wavPath));
  form.append("model", "parakeet-tdt-0.6b-v3");
  const res = await fetch(`${apiUrl}/v1/audio/transcriptions`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`STT error: ${res.status}`);
  const data = (await res.json()) as { text: string };
  return data.text.trim();
}
