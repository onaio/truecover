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
   * Active state - shows accent border/text with transparent background
   * @default false
   */
  isActive?: boolean;
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
  isActive = false,
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

  // Active state classes - transparent background with accent color
  const activeVariantClasses = {
    primary: `
      bg-transparent
      border-tactical-text-primary
      text-tactical-text-primary
      hover:bg-tactical-text-primary/10
    `,
    secondary: `
      bg-transparent
      border-tactical-border-light
      text-tactical-text-primary
      hover:bg-tactical-bg-tertiary/50
    `,
    ghost: `
      bg-transparent
      border-transparent
      text-tactical-text-primary
      hover:bg-tactical-bg-tertiary/50
    `,
    danger: `
      bg-transparent
      border-tactical-accent-red
      text-tactical-accent-red
      hover:bg-tactical-accent-red/10
    `,
    success: `
      bg-transparent
      border-tactical-accent-green
      text-tactical-accent-green
      hover:bg-tactical-accent-green/10
    `,
  };

  const variantClasses = {
    primary: `
      bg-transparent
      border-tactical-text-primary
      border-1.5
      text-tactical-text-primary
      hover:bg-tactical-text-primary
      hover:text-tactical-bg-primary
      active:bg-tactical-bg-tertiary
      active:text-tactical-text-primary
    `,
    secondary: `
      bg-transparent
      border-tactical-border-light
      border-1.5
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
      border-1.5
      text-tactical-accent-red
      hover:bg-tactical-accent-red
      hover:text-tactical-text-primary
      active:bg-tactical-accent-red-dim
    `,
    success: `
      bg-transparent
      border-tactical-accent-green
      border-1.5
      text-tactical-accent-green
      hover:bg-tactical-accent-green
      hover:text-tactical-text-primary
      active:bg-tactical-bg-tertiary
      active:text-tactical-accent-green
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
        ${isActive ? activeVariantClasses[variant] : variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {children}
    </button>
  );
};

export default TacticalButton;
