import React from 'react';

export interface TacticalBadgeProps {
  /**
   * Badge content
   */
  children: React.ReactNode;
  /**
   * Badge variant
   * @default 'default'
   */
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'info';
  /**
   * Badge size
   * @default 'sm'
   */
  size?: 'xs' | 'sm' | 'md';
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * TacticalBadge - Status/label indicators with tactical styling
 *
 * @example
 * <TacticalBadge variant="success">ACTIVE</TacticalBadge>
 * <TacticalBadge variant="danger">HIGH RISK</TacticalBadge>
 */
export const TacticalBadge: React.FC<TacticalBadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  className = '',
}) => {
  const variantClasses = {
    default: 'bg-tactical-bg-tertiary border-tactical-border-medium text-tactical-text-muted',
    success: 'border-tactical-accent-green text-tactical-accent-green',
    danger: 'border-tactical-accent-red text-tactical-accent-red',
    warning: 'border-yellow-600 text-yellow-400',
    info: 'border-tactical-accent-blue text-tactical-accent-blue',
  };

  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-xs',
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
  };

  return (
    <span
      className={`
        inline-block
        font-mono
        uppercase
        tracking-wider
        border
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {children}
    </span>
  );
};

export default TacticalBadge;
