import React, { useState } from 'react';

export interface TacticalCollapsibleProps {
  title: string | React.ReactNode;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
  collapsedSummary?: string;
  actionButton?: React.ReactNode;
  className?: string;
}

export const TacticalCollapsible: React.FC<TacticalCollapsibleProps> = ({
  title,
  children,
  defaultCollapsed = false,
  collapsedSummary,
  actionButton,
  className = '',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className={className}>
      <div className={`flex justify-between items-center ${!isCollapsed ? 'mb-4' : ''}`}>
        <div
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <span className="text-tactical-text-dim">
            {isCollapsed ? '▶' : '▼'}
          </span>
          <h2 className="text-lg font-bold text-tactical-text-primary uppercase tracking-wider">
            {title}
            {isCollapsed && collapsedSummary && (
              <span className="ml-2 text-sm text-tactical-text-dim font-normal">
                {collapsedSummary}
              </span>
            )}
          </h2>
        </div>
        {!isCollapsed && actionButton}
      </div>

      {!isCollapsed && children}
    </div>
  );
};
