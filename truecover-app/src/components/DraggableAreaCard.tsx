// ABOUTME: Draggable card component for admin boundary areas in cluster sampling wizard
// ABOUTME: Used in the categorization step to drag areas between risk categories

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

interface DraggableAreaCardProps {
  id: string;
  name: string;
  pcode: string;
  population?: number;
}

export const DraggableAreaCard: React.FC<DraggableAreaCardProps> = ({
  id,
  name,
  pcode,
  population,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        p-2 mb-2 bg-zinc-800 border border-zinc-700 rounded cursor-grab
        hover:border-cyan-500 transition-colors
        ${isDragging ? 'cursor-grabbing shadow-lg' : ''}
      `}
    >
      <div className="text-sm font-medium text-zinc-100">{name}</div>
      <div className="text-xs text-zinc-400">{pcode}</div>
      {population !== undefined && population > 0 && (
        <div className="text-xs text-cyan-400 mt-1">
          Pop: {population.toLocaleString()}
        </div>
      )}
    </div>
  );
};
