export async function register() {
  // Only run on server (not edge runtime or client)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWorkers } = await import('@/lib/workers');
    console.log('[Instrumentation] Starting workers on server startup');
    // Don't await - workers run forever, so we fire and forget
    startWorkers().catch((err) => {
      console.error('[Instrumentation] Failed to start workers:', err);
    });
  }
}
