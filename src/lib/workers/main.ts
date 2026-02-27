// Standalone entry point for the indexer container.
// Starts all workers and exposes a /health HTTP endpoint.

// Connection pooling must be initialized before any fetch calls
import '../httpAgent';

import * as http from 'http';
import { startWorkers, stopWorkers, getAllWorkerStatuses } from './index';

const PORT = parseInt(process.env.PORT || '3003', 10);

// Minimal HTTP server for Docker healthcheck
const server = http.createServer((_req, res) => {
  const statuses = getAllWorkerStatuses();
  const healthy = statuses.length > 0 && statuses.some(s => s.state === 'running' || s.state === 'idle');

  res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: healthy ? 'healthy' : 'unhealthy',
    workers: statuses.map(s => ({ name: s.name, state: s.state })),
  }));
});

async function main() {
  console.log('[Indexer] Starting standalone indexer process...');

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Indexer] Health endpoint listening on :${PORT}`);
  });

  await startWorkers();
  console.log('[Indexer] All workers started');
}

function shutdown() {
  console.log('[Indexer] Shutting down...');
  stopWorkers();
  server.close(() => {
    console.log('[Indexer] HTTP server closed');
    process.exit(0);
  });
  // Force exit if server doesn't close within 5s
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => {
  console.error('[Indexer] Unhandled rejection:', reason);
});

main().catch((err) => {
  console.error('[Indexer] Fatal error:', err);
  process.exit(1);
});
