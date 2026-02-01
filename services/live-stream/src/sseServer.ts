import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { StreamBlock, SSEMessage, SSEBlockUpdateMessage, BlockUpdatePayload } from './types.js';
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
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
      } else if (url.pathname === '/update' && req.method === 'POST') {
        this.handleUpdate(req, res);
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
   * Handle POST /update requests for block updates.
   */
  private handleUpdate(req: IncomingMessage, res: ServerResponse): void {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as BlockUpdatePayload;

        if (!payload.blockNumber) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'blockNumber is required' }));
          return;
        }

        // Build updates object from payload
        const updates: Partial<StreamBlock> = {};
        if (payload.txCount !== undefined) {
          updates.txCount = payload.txCount;
          // Recalculate TPS if we have blockTimeSec
          const existingBlock = this.ringBuffer.get(payload.blockNumber);
          if (existingBlock?.blockTimeSec && existingBlock.blockTimeSec > 0) {
            updates.tps = payload.txCount / existingBlock.blockTimeSec;
          }
        }
        if (payload.minPriorityFeeGwei !== undefined) {
          updates.minPriorityFeeGwei = payload.minPriorityFeeGwei;
        }
        if (payload.maxPriorityFeeGwei !== undefined) {
          updates.maxPriorityFeeGwei = payload.maxPriorityFeeGwei;
        }
        if (payload.avgPriorityFeeGwei !== undefined) {
          updates.avgPriorityFeeGwei = payload.avgPriorityFeeGwei;
        }
        if (payload.medianPriorityFeeGwei !== undefined) {
          updates.medianPriorityFeeGwei = payload.medianPriorityFeeGwei;
        }
        if (payload.totalPriorityFeeGwei !== undefined) {
          updates.totalPriorityFeeGwei = payload.totalPriorityFeeGwei;
        }
        if (payload.finalized !== undefined) {
          updates.finalized = payload.finalized;
        }
        if (payload.finalizedAt !== undefined) {
          updates.finalizedAt = payload.finalizedAt;
          // Calculate timeToFinalitySec if not provided and block data exists
          if (payload.timeToFinalitySec === undefined) {
            const existingBlock = this.ringBuffer.get(payload.blockNumber);
            if (existingBlock?.timestamp) {
              updates.timeToFinalitySec = payload.finalizedAt - existingBlock.timestamp;
            }
          }
        }
        if (payload.milestoneId !== undefined) {
          updates.milestoneId = payload.milestoneId;
        }
        if (payload.timeToFinalitySec !== undefined) {
          updates.timeToFinalitySec = payload.timeToFinalitySec;
        }

        // Update the block in the ring buffer
        const updated = this.ringBuffer.update(payload.blockNumber, updates);

        if (updated) {
          // Broadcast update to all SSE clients
          this.broadcastBlockUpdate(payload.blockNumber, updates);
          console.log(`[SSE] Block #${payload.blockNumber} updated:`, Object.keys(updates).join(', '));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, updated }));
      } catch (error) {
        console.error('[SSE] Error processing update:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });

    req.on('error', (error) => {
      console.error('[SSE] Error reading request body:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
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
   * Broadcast a block update to all connected SSE clients.
   */
  broadcastBlockUpdate(blockNumber: number, updates: Partial<StreamBlock>): void {
    const message: SSEBlockUpdateMessage = {
      type: 'block_update',
      blockNumber,
      updates,
    };

    for (const client of this.clients) {
      this.sendSSE(client, message);
    }
  }

  /**
   * Send an SSE message to a client.
   */
  private sendSSE(res: ServerResponse, message: SSEMessage | SSEBlockUpdateMessage): void {
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
