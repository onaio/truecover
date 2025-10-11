import React from 'react';

export interface TacticalTextareaProps {
  /**
   * Textarea value
   */
  value: string;
  /**
   * Change handler
   */
  onChange: (value: string) => void;
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
   * Number of rows
   * @default 3
   */
  rows?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * ID for the textarea
   */
  id?: string;
}

/**
 * TacticalTextarea - Terminal-style multiline text input
 *
 * @example
 * <TacticalTextarea
 *   label="Mission Notes"
 *   value={notes}
 *   onChange={setNotes}
 *   placeholder="Enter mission notes..."
 *   rows={5}
 * />
 */
export const TacticalTextarea: React.FC<TacticalTextareaProps> = ({
  value,
  onChange,
  placeholder,
  label,
  disabled = false,
  fullWidth = true,
  error = false,
  helperText,
  rows = 3,
  className = '',
  id,
}) => {
  return (
    <div className={`${fullWidth ? 'w-full' : ''} ${className}`}>
      {label && (
        <label className="block mb-2 text-xs font-mono text-tactical-text-muted uppercase tracking-wider">
          {label}
        </label>
      )}

      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className={`
          w-full
          px-3 py-2
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
          resize-vertical
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

export default TacticalTextarea;
