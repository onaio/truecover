import React from 'react';
import { CornerBrackets } from './CornerBrackets';

export interface TacticalCardProps {
  /**
   * Card content
   */
  children: React.ReactNode;
  /**
   * Card title
   */
  title?: string;
  /**
   * Show corner brackets
   * @default true
   */
  showBrackets?: boolean;
  /**
   * Border style
   * @default 'medium'
   */
  borderStyle?: 'light' | 'medium' | 'dark' | 'none';
  /**
   * Background variant
   * @default 'primary'
   */
  variant?: 'primary' | 'secondary' | 'tertiary';
  /**
   * Enable hover effect
   * @default false
   */
  hoverable?: boolean;
  /**
   * Additional padding
   * @default 'md'
   */
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Click handler
   */
  onClick?: () => void;
}

/**
 * TacticalCard - A panel with corner brackets and tactical styling
 *
 * @example
 * <TacticalCard title="Operations">
 *   <p>Content here</p>
 * </TacticalCard>
 */
export const TacticalCard: React.FC<TacticalCardProps> = ({
  children,
  title,
  showBrackets = true,
  borderStyle = 'medium',
  variant = 'primary',
  hoverable = false,
  padding = 'md',
  className = '',
  onClick,
}) => {
  const borderColorMap = {
    light: 'border-tactical-border-light',
    medium: 'border-tactical-border-medium',
    dark: 'border-tactical-border-dark',
    none: 'border-transparent',
  };

  const bgColorMap = {
    primary: 'bg-tactical-bg-primary',
    secondary: 'bg-tactical-bg-secondary',
    tertiary: 'bg-tactical-bg-tertiary',
  };

  const paddingMap = {
    none: 'p-0',
    sm: 'p-2',
    md: 'p-4',
    lg: 'p-6',
    xl: 'p-8',
  };

  return (
    <div
      className={`
        relative
        ${bgColorMap[variant]}
        border ${borderColorMap[borderStyle]}
        ${paddingMap[padding]}
        ${hoverable ? 'cursor-pointer transition-colors hover:bg-tactical-bg-secondary hover:border-tactical-border-light' : ''}
        ${className}
      `}
      onClick={onClick}
    >
      {showBrackets && <CornerBrackets />}

      {title && (
        <div className="mb-4 pb-3 border-b border-tactical-border-dark">
          <h3 className="text-tactical-text-primary font-mono text-sm font-medium uppercase tracking-wider">
            {title}
          </h3>
        </div>
      )}

      <div className="font-mono text-tactical-text-secondary text-sm">
        {children}
      </div>
    </div>
  );
};

export default TacticalCard;
