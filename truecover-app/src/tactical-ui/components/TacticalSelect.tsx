import React from 'react';

export interface TacticalSelectOption {
  value: string | number;
  label: string;
}

export interface TacticalSelectProps {
  /**
   * Selected value
   */
  value: string | number;
  /**
   * Change handler
   */
  onChange: (value: string) => void;
  /**
   * Options array
   */
  options: TacticalSelectOption[];
  /**
   * Label text
   */
  label?: string;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Helper text shown below the select
   */
  helperText?: string;
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
   * Additional CSS classes
   */
  className?: string;
}

/**
 * TacticalSelect - Dropdown select with tactical styling
 *
 * @example
 * <TacticalSelect
 *   label="Mission Type"
 *   value={missionType}
 *   onChange={setMissionType}
 *   options={[
 *     { value: 'recon', label: 'Reconnaissance' },
 *     { value: 'assault', label: 'Assault' }
 *   ]}
 * />
 */
export const TacticalSelect: React.FC<TacticalSelectProps> = ({
  value,
  onChange,
  options,
  label,
  placeholder,
  helperText,
  disabled = false,
  fullWidth = true,
  className = '',
}) => {
  return (
    <div className={`${fullWidth ? 'w-full' : ''} ${className}`}>
      {label && (
        <label className="block mb-2 text-xs font-mono text-tactical-text-muted uppercase tracking-wider">
          {label}
        </label>
      )}

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`
          w-full
          px-3 py-2
          bg-tactical-bg-primary
          border border-tactical-border-medium
          text-tactical-text-primary
          font-mono text-sm
          focus:outline-none
          focus:border-orange-500
          focus:ring-1 focus:ring-orange-500
          disabled:opacity-50
          disabled:cursor-not-allowed
          cursor-pointer
          transition-colors
        `}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {helperText && (
        <p className="mt-1 text-xs font-mono text-tactical-text-dim">
          {helperText}
        </p>
      )}
    </div>
  );
};

export default TacticalSelect;
