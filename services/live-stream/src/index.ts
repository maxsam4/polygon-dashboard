import { RingBuffer } from './ringBuffer.js';
import { WSManager } from './wsManager.js';
import { SSEServer } from './sseServer.js';

// Configuration from environment
const PORT = parseInt(process.env.PORT || '3002', 10);
const RING_BUFFER_SIZE = parseInt(process.env.RING_BUFFER_SIZE || '25', 10);
const WS_URLS = (process.env.POLYGON_WS_URLS || '').split(',').filter(Boolean);

if (WS_URLS.length === 0) {
  console.error('[LiveStream] No WebSocket URLs configured. Set POLYGON_WS_URLS environment variable.');
  process.exit(1);
}

console.log('[LiveStream] Starting Polygon Live Stream Service');
console.log(`[LiveStream] Port: ${PORT}`);
console.log(`[LiveStream] Ring buffer size: ${RING_BUFFER_SIZE}`);
console.log(`[LiveStream] WebSocket endpoints: ${WS_URLS.length}`);

// Initialize components
const ringBuffer = new RingBuffer(RING_BUFFER_SIZE);
const wsManager = new WSManager(WS_URLS, ringBuffer);
const sseServer = new SSEServer(PORT, ringBuffer, wsManager);

// Wire up block notifications
wsManager.setBlockCallback((block) => {
  sseServer.broadcastBlock(block);
});

// Start services
sseServer.start();
wsManager.connectAll();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[LiveStream] Received SIGTERM, shutting down...');
  wsManager.disconnectAll();
  sseServer.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[LiveStream] Received SIGINT, shutting down...');
  wsManager.disconnectAll();
  sseServer.stop();
  process.exit(0);
});

// Log status periodically
setInterval(() => {
  const status = wsManager.getStatus();
  const highestBlock = ringBuffer.getHighest();
  console.log(
    `[LiveStream] Status: ${status.connected}/${status.total} WS connected, ` +
    `buffer: ${ringBuffer.size} blocks, highest: ${highestBlock || 'none'}`
  );
}, 30000);
