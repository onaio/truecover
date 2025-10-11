import React from 'react';

export interface TacticalDatePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
}

export const TacticalDatePicker: React.FC<TacticalDatePickerProps> = ({
  label,
  value,
  onChange,
  disabled = false,
  required = false,
  placeholder = 'Select date'
}) => {
  return (
    <div>
      <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
        {label}
        {required && <span className="text-tactical-accent-red ml-1">*</span>}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-sm focus:outline-none focus:border-tactical-accent-orange disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-calendar-picker-indicator]:filter [&::-webkit-calendar-picker-indicator]:invert"
      />
    </div>
  );
};
