/**
 * Global HTTP Agent configuration for connection pooling.
 *
 * This module configures undici (Node.js's fetch implementation) with
 * proper connection pooling and keep-alive settings to prevent ECONNRESET
 * errors from connection exhaustion.
 *
 * Import this module early in the application lifecycle to ensure
 * all fetch calls benefit from connection pooling.
 */

import { Agent, setGlobalDispatcher } from 'undici';

// Configure a global agent with connection pooling
const agent = new Agent({
  // Keep connections alive for 30 seconds after last request
  keepAliveTimeout: 30_000,
  // Maximum time a connection can be kept alive
  keepAliveMaxTimeout: 60_000,
  // Maximum connections per origin (RPC endpoint)
  connections: 50,
  // Pipeline up to 10 requests per connection
  pipelining: 10,
  // Connection timeout
  connect: {
    timeout: 30_000,
  },
});

setGlobalDispatcher(agent);

console.log('[httpAgent] Global HTTP agent configured with connection pooling');

export { agent };
