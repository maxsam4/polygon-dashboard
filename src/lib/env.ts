function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name] ?? defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEnvVarList(name: string, defaultValue?: string): string[] {
  const value = getEnvVar(name, defaultValue);
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function getEnvVarInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }
  return parsed;
}

export const env = {
  polygonRpcUrls: getEnvVarList('POLYGON_RPC_URLS'),
  heimdallApiUrls: getEnvVarList('HEIMDALL_API_URLS', 'https://heimdall-api.polygon.technology'),
  databaseUrl: getEnvVar('DATABASE_URL'),
  backfillToBlock: getEnvVarInt('BACKFILL_TO_BLOCK', 50000000),
  backfillBatchSize: getEnvVarInt('BACKFILL_BATCH_SIZE', 100),
  rpcDelayMs: getEnvVarInt('RPC_DELAY_MS', 100),
  milestoneBackfillToSequence: getEnvVarInt('MILESTONE_BACKFILL_TO_SEQUENCE', 1),
  milestoneBackfillBatchSize: getEnvVarInt('MILESTONE_BACKFILL_BATCH_SIZE', 50),
} as const;
