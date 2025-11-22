import React, { useState } from 'react';

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
  /**
   * Show visibility toggle for password fields
   * @default false
   */
  showToggle?: boolean;
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
  showToggle = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  const shouldShowToggle = showToggle && type === 'password';
  const inputType = shouldShowToggle && isVisible ? 'text' : type;

  return (
    <div className={`${fullWidth ? 'w-full' : ''} ${className}`}>
      {label && (
        <label className="block mb-2 text-xs font-mono text-tactical-text-muted uppercase tracking-wider">
          {label}
        </label>
      )}

      <div className="relative">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            w-full
            px-3 py-2
            ${shouldShowToggle ? 'pr-10' : ''}
            bg-tactical-bg-primary
            border ${error ? 'border-tactical-accent-red' : 'border-tactical-border-medium'}
            text-tactical-text-primary
            font-mono text-sm
            focus:outline-none
            focus:border-orange-500
            focus:ring-1 focus:ring-orange-500
            disabled:opacity-50
            disabled:cursor-not-allowed
            transition-colors
            placeholder:text-tactical-text-dim
          `}
        />

        {shouldShowToggle && (
          <button
            type="button"
            onClick={() => setIsVisible(!isVisible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-tactical-text-muted hover:text-tactical-text-primary transition-colors"
            tabIndex={-1}
          >
            {isVisible ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </div>

      {helperText && (
        <p className={`mt-1 text-xs font-mono ${error ? 'text-tactical-accent-red' : 'text-tactical-text-dim'}`}>
          {helperText}
        </p>
      )}
    </div>
  );
};

export default TacticalInput;
