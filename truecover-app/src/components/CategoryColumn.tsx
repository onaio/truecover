// ABOUTME: Droppable column component for risk categories in cluster sampling wizard
// ABOUTME: Serves as drop target for DraggableAreaCard components

import React from 'react';
import { useDroppable } from '@dnd-kit/core';

interface CategoryColumnProps {
  id: string;
  title: string;
  count: number;
  color: 'red' | 'green' | 'yellow' | 'gray';
  children: React.ReactNode;
  totalPopulation?: number;
}

const colorClasses = {
  red: 'border-red-500/50 bg-red-950/20',
  green: 'border-green-500/50 bg-green-950/20',
  yellow: 'border-yellow-500/50 bg-yellow-950/20',
  gray: 'border-zinc-500/50 bg-zinc-900/50',
};

const headerClasses = {
  red: 'text-red-400',
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  gray: 'text-zinc-400',
};

export const CategoryColumn: React.FC<CategoryColumnProps> = ({
  id,
  title,
  count,
  color,
  children,
  totalPopulation,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`
        flex-1 min-w-[220px] p-3 rounded border-2 flex flex-col
        ${colorClasses[color]}
        ${isOver ? 'ring-2 ring-cyan-400' : ''}
        transition-all
      `}
    >
      <div className={`text-sm font-bold mb-3 ${headerClasses[color]}`}>
        {title} ({count})
      </div>
      <div className="flex-1 min-h-[200px] max-h-[350px] overflow-y-auto tactical-scrollbar">
        {children}
      </div>
      {totalPopulation !== undefined && (
        <div className={`mt-3 pt-2 border-t border-zinc-700 text-xs font-mono ${headerClasses[color]}`}>
          Pop: {totalPopulation.toLocaleString()}
        </div>
      )}
    </div>
  );
};
