import React from 'react';

export interface TacticalButtonProps {
  /**
   * Button content
   */
  children: React.ReactNode;
  /**
   * Button variant
   * @default 'primary'
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  /**
   * Button size
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Disabled state
   * @default false
   */
  disabled?: boolean;
  /**
   * Full width
   * @default false
   */
  fullWidth?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Button type
   * @default 'button'
   */
  type?: 'button' | 'submit' | 'reset';
}

/**
 * TacticalButton - A button with tactical styling
 *
 * @example
 * <TacticalButton variant="primary" onClick={() => console.log('clicked')}>
 *   Execute
 * </TacticalButton>
 */
export const TacticalButton: React.FC<TacticalButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  className = '',
  onClick,
  type = 'button',
}) => {
  const baseClasses = `
    font-mono
    uppercase
    tracking-wider
    border
    transition-all
    duration-200
    ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
    ${fullWidth ? 'w-full' : ''}
  `;

  const variantClasses = {
    primary: `
      bg-transparent
      border-tactical-text-primary
      border-2
      text-tactical-text-primary
      hover:bg-tactical-text-primary
      hover:text-tactical-bg-primary
      active:bg-tactical-bg-tertiary
      active:text-tactical-text-primary
    `,
    secondary: `
      bg-transparent
      border-tactical-border-light
      text-tactical-text-primary
      hover:bg-tactical-bg-tertiary
      hover:border-tactical-text-primary
      active:bg-tactical-bg-secondary
    `,
    ghost: `
      bg-transparent
      border-transparent
      text-tactical-text-muted
      hover:text-tactical-text-primary
      hover:bg-tactical-bg-tertiary
      active:bg-tactical-bg-secondary
    `,
    danger: `
      bg-transparent
      border-tactical-accent-red
      border-2
      text-tactical-accent-red
      hover:bg-tactical-accent-red
      hover:text-tactical-text-primary
      active:bg-tactical-accent-red-dim
    `,
    success: `
      bg-transparent
      border-tactical-accent-green
      border-2
      text-tactical-accent-green
      hover:bg-tactical-accent-orange
      hover:text-tactical-text-primary
      hover:border-tactical-accent-orange
      active:bg-tactical-accent-green-dim
      active:border-tactical-accent-green
    `,
  };

  const sizeClasses = {
    sm: 'px-3 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`
        ${baseClasses}
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {children}
    </button>
  );
};

export default TacticalButton;
