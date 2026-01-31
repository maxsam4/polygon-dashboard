import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { StreamBlock, SSEMessage } from './types.js';
import { RingBuffer } from './ringBuffer.js';
import { WSManager } from './wsManager.js';

type SSEClient = ServerResponse;

export class SSEServer {
  private port: number;
  private ringBuffer: RingBuffer;
  private wsManager: WSManager;
  private clients: Set<SSEClient> = new Set();
  private server: ReturnType<typeof createServer> | null = null;

  constructor(port: number, ringBuffer: RingBuffer, wsManager: WSManager) {
    this.port = port;
    this.ringBuffer = ringBuffer;
    this.wsManager = wsManager;
  }

  /**
   * Start the HTTP server.
   */
  start(): void {
    this.server = createServer((req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${this.port}`);

      if (url.pathname === '/stream') {
        this.handleStream(req, res);
      } else if (url.pathname === '/health') {
        this.handleHealth(req, res);
      } else if (url.pathname === '/status') {
        this.handleStatus(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.server.listen(this.port, () => {
      console.log(`[SSE] Server listening on port ${this.port}`);
    });
  }

  /**
   * Handle SSE stream requests.
   */
  private handleStream(req: IncomingMessage, res: ServerResponse): void {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial blocks
    const initialBlocks = this.ringBuffer.getAll();
    const initialMessage: SSEMessage = {
      type: 'initial',
      blocks: initialBlocks,
    };
    this.sendSSE(res, initialMessage);

    // Add client to set
    this.clients.add(res);
    console.log(`[SSE] Client connected (total: ${this.clients.size})`);

    // Handle client disconnect
    req.on('close', () => {
      this.clients.delete(res);
      console.log(`[SSE] Client disconnected (total: ${this.clients.size})`);
    });
  }

  /**
   * Handle health check requests.
   */
  private handleHealth(req: IncomingMessage, res: ServerResponse): void {
    const wsStatus = this.wsManager.getStatus();
    const healthy = wsStatus.connected > 0;

    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'healthy' : 'unhealthy',
      websockets: wsStatus,
      bufferSize: this.ringBuffer.size,
      clients: this.clients.size,
    }));
  }

  /**
   * Handle detailed status requests.
   */
  private handleStatus(req: IncomingMessage, res: ServerResponse): void {
    const wsStatus = this.wsManager.getStatus();
    const blocks = this.ringBuffer.getAll();
    const highestBlock = this.ringBuffer.getHighest();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      websockets: wsStatus,
      buffer: {
        size: this.ringBuffer.size,
        highestBlock,
        blocks: blocks.map(b => ({
          number: b.blockNumber,
          hash: b.blockHash.slice(0, 10) + '...',
          timestamp: b.timestamp,
        })),
      },
      clients: this.clients.size,
    }));
  }

  /**
   * Broadcast a new block to all connected SSE clients.
   */
  broadcastBlock(block: StreamBlock): void {
    const message: SSEMessage = {
      type: 'update',
      block,
    };

    for (const client of this.clients) {
      this.sendSSE(client, message);
    }
  }

  /**
   * Send an SSE message to a client.
   */
  private sendSSE(res: ServerResponse, message: SSEMessage): void {
    // Convert BigInt to string for JSON serialization
    const serialized = JSON.stringify(message, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    res.write(`data: ${serialized}\n\n`);
  }

  /**
   * Stop the HTTP server.
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.clients.clear();
  }
}
