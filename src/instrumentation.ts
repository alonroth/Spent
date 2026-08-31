export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initScheduler } = await import("@/server/sync/scheduler");
  initScheduler();
  const { startRemoteAccessIfEnabled } = await import("@/server/remote-access");
  try {
    await startRemoteAccessIfEnabled();
  } catch {
    // Keep the loopback app available, but never expose an enabled LAN mode
    // when its HTTPS boundary could not be initialized. The launcher checks
    // the health flags and fails closed in that case.
    console.error("[remote-access] secure LAN boundary was not started");
  }
}
