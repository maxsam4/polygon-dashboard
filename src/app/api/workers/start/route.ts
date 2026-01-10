import { NextResponse } from 'next/server';
import { startWorkers, areWorkersRunning } from '@/lib/workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const running = areWorkersRunning();
  return NextResponse.json({
    status: running ? 'running' : 'stopped',
    message: running ? 'Workers are running' : 'Workers not started. Send POST to start.',
  });
}

export async function POST() {
  if (areWorkersRunning()) {
    return NextResponse.json({ status: 'running', message: 'Workers already started' });
  }

  try {
    await startWorkers();
    return NextResponse.json({ status: 'running', message: 'Workers started successfully' });
  } catch (error) {
    console.error('Failed to start workers:', error);
    return NextResponse.json({ status: 'error', error: 'Failed to start workers' }, { status: 500 });
  }
}
