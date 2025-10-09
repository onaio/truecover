import React from 'react';

export interface TacticalInputProps {
  /**
   * Input value
   */
  value: string | number;
  /**
   * Change handler
   */
  onChange: (value: string) => void;
  /**
   * Input type
   * @default 'text'
   */
  type?: 'text' | 'number' | 'email' | 'password';
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Label text
   */
  label?: string;
  /**
   * Disabled state
   * @default false
   */
  disabled?: boolean;
  /**
   * Full width
   * @default true
   */
  fullWidth?: boolean;
  /**
   * Error state
   * @default false
   */
  error?: boolean;
  /**
   * Helper text
   */
  helperText?: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * TacticalInput - Terminal-style text input
 *
 * @example
 * <TacticalInput
 *   label="Mission Code"
 *   value={code}
 *   onChange={setCode}
 *   placeholder="Enter mission code..."
 * />
 */
export const TacticalInput: React.FC<TacticalInputProps> = ({
  value,
  onChange,
  type = 'text',
  placeholder,
  label,
  disabled = false,
  fullWidth = true,
  error = false,
  helperText,
  className = '',
}) => {
  return (
    <div className={`${fullWidth ? 'w-full' : ''} ${className}`}>
      {label && (
        <label className="block mb-2 text-xs font-mono text-tactical-text-muted uppercase tracking-wider">
          {label}
        </label>
      )}

      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`
          w-full
          px-3 py-2
          bg-tactical-bg-primary
          border ${error ? 'border-tactical-accent-red' : 'border-tactical-border-medium'}
          text-tactical-text-primary
          font-mono text-sm
          focus:outline-none
          focus:border-tactical-accent-red
          focus:ring-1 focus:ring-tactical-accent-red
          disabled:opacity-50
          disabled:cursor-not-allowed
          transition-colors
          placeholder:text-tactical-text-dim
        `}
      />

      {helperText && (
        <p className={`mt-1 text-xs font-mono ${error ? 'text-tactical-accent-red' : 'text-tactical-text-dim'}`}>
          {helperText}
        </p>
      )}
    </div>
  );
};

export default TacticalInput;
