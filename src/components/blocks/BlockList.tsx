'use client';

import { BlockRow } from './BlockRow';
import { BlockDataUI } from '@/lib/types';

interface BlockListProps {
  blocks: BlockDataUI[];
  title?: string;
}

export function BlockList({ blocks, title = 'Latest Blocks' }: BlockListProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {blocks.length === 0 ? (
          <div className="p-4 text-center text-gray-500">No blocks found</div>
        ) : (
          blocks.map((block) => <BlockRow key={block.blockNumber} block={block} />)
        )}
      </div>
    </div>
  );
}
