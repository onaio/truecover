import React from 'react';
import { CornerBrackets } from './CornerBrackets';

export interface TacticalHeaderProps {
  /**
   * Main title
   */
  title: string;
  /**
   * Subtitle or description
   */
  subtitle?: string;
  /**
   * Actions to display in the header (e.g., buttons)
   */
  actions?: React.ReactNode;
  /**
   * Show corner brackets
   * @default true
   */
  showBrackets?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * TacticalHeader - Page header with title, subtitle, and actions
 *
 * @example
 * <TacticalHeader
 *   title="Mission Control"
 *   subtitle="Active operations: 24"
 *   actions={<TacticalButton>New Mission</TacticalButton>}
 * />
 */
export const TacticalHeader: React.FC<TacticalHeaderProps> = ({
  title,
  subtitle,
  actions,
  showBrackets = true,
  className = '',
}) => {
  return (
    <header
      className={`
        relative
        bg-tactical-bg-secondary
        border-b border-tactical-border-medium
        px-6 py-4
        ${className}
      `}
    >
      {showBrackets && <CornerBrackets />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold text-tactical-text-primary uppercase tracking-wider">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 font-mono text-sm text-tactical-text-muted">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
};

export default TacticalHeader;
