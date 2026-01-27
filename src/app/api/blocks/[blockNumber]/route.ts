import { NextRequest, NextResponse } from 'next/server';
import { getBlockByNumber } from '@/lib/queries/blocks';
import { getRpcClient } from '@/lib/rpc';
import { TransactionDetails } from '@/lib/types';
import { formatUnits } from 'viem';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ blockNumber: string }> }
) {
  try {
    const { blockNumber } = await params;
    const blockNum = BigInt(blockNumber);

    // Get block from DB (has our computed metrics)
    const block = await getBlockByNumber(blockNum);
    if (!block) {
      return NextResponse.json({ error: 'Block not found in database' }, { status: 404 });
    }

    // Fetch transactions from RPC on-demand
    const rpc = getRpcClient();
    const [rpcBlock, receipts] = await Promise.all([
      rpc.getBlockWithTransactions(blockNum),
      rpc.getBlockReceipts(blockNum),
    ]);

    // Build receipt lookup map
    const receiptsList = Array.isArray(receipts) ? receipts : [];
    const receiptMap = new Map(
      receiptsList.map(r => [r.transactionHash, r])
    );

    // Merge transaction data with receipts
    const transactions: TransactionDetails[] = rpcBlock.transactions
      .filter((tx): tx is Exclude<typeof tx, string> => typeof tx !== 'string')
      .map(tx => {
        const receipt = receiptMap.get(tx.hash);
        return {
          hash: tx.hash,
          from: tx.from,
          to: tx.to ?? null,
          value: formatUnits(tx.value, 18),  // Convert wei to POL
          gasLimit: tx.gas.toString(),
          gasUsed: receipt?.gasUsed?.toString() ?? null,
          gasPrice: tx.gasPrice?.toString() ?? null,
          maxFeePerGas: tx.maxFeePerGas?.toString() ?? null,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString() ?? null,
          effectiveGasPrice: receipt?.effectiveGasPrice?.toString() ?? null,
          nonce: tx.nonce,
          transactionIndex: receipt?.transactionIndex ?? null,
          status: receipt?.status === 'success' ? 'success' : receipt?.status === 'reverted' ? 'reverted' : null,
          type: tx.type ?? 'legacy',
          input: tx.input,
          contractAddress: receipt?.contractAddress ?? null,
        };
      })
      .sort((a, b) => (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0));

    // Serialize block data
    const response = {
      block: {
        blockNumber: block.blockNumber.toString(),
        timestamp: block.timestamp.toISOString(),
        blockHash: block.blockHash,
        parentHash: block.parentHash,
        gasUsed: block.gasUsed.toString(),
        gasLimit: block.gasLimit.toString(),
        gasUsedPercent: (Number(block.gasUsed) / Number(block.gasLimit)) * 100,
        baseFeeGwei: block.baseFeeGwei,
        avgPriorityFeeGwei: block.avgPriorityFeeGwei,
        medianPriorityFeeGwei: block.medianPriorityFeeGwei,
        minPriorityFeeGwei: block.minPriorityFeeGwei,
        maxPriorityFeeGwei: block.maxPriorityFeeGwei,
        totalBaseFeeGwei: block.totalBaseFeeGwei,
        totalPriorityFeeGwei: block.totalPriorityFeeGwei,
        txCount: block.txCount,
        blockTimeSec: block.blockTimeSec,
        mgasPerSec: block.mgasPerSec,
        tps: block.tps,
        finalized: block.finalized,
        finalizedAt: block.finalizedAt?.toISOString() ?? null,
        timeToFinalitySec: block.timeToFinalitySec,
        milestoneId: block.milestoneId?.toString() ?? null,
      },
      transactions,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching block details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch block details' },
      { status: 500 }
    );
  }
}
