import { NextResponse } from 'next/server';
import { startWorkers } from '@/lib/workers';

let started = false;

export async function POST() {
  if (started) {
    return NextResponse.json({ message: 'Workers already started' });
  }

  try {
    await startWorkers();
    started = true;
    return NextResponse.json({ message: 'Workers started' });
  } catch (error) {
    console.error('Failed to start workers:', error);
    return NextResponse.json({ error: 'Failed to start workers' }, { status: 500 });
  }
}
