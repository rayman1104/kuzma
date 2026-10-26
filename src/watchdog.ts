export function startWatchdog(): Timer {
  const botPid = process.pid;
  return setInterval(async () => {
    try {
      const proc = Bun.spawn({ cmd: ["pgrep", "-f", "claude.*stream-json"], stdout: "pipe" });
      const text = await new Response(proc.stdout).text();
      const pids = text.trim().split("\n").filter(Boolean).map(Number);
      for (const pid of pids) {
        if (isNaN(pid)) continue;
        // Only touch Claude processes spawned by the bot (current or previous instance): other
        // stream-json sessions on the host (e.g. Claude Code driven by an IDE) are not ours.
        const environ = await Bun.file(`/proc/${pid}/environ`).text().catch(() => "");
        if (!environ.split("\0").includes("KUZMA_CHILD=1")) continue;
        const pp = Bun.spawn({ cmd: ["ps", "-o", "ppid=", "-p", String(pid)], stdout: "pipe" });
        const ppid = Number((await new Response(pp.stdout).text()).trim());
        if (ppid !== botPid && ppid > 1) {
          console.warn(`Killing orphan claude pid ${pid}`);
          process.kill(pid, "SIGKILL");
        }
      }
    } catch {}
  }, 60_000);
}
