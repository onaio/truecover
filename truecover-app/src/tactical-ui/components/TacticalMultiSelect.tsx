import React, { useState, useRef, useEffect } from 'react';

export interface TacticalMultiSelectOption {
  value: number | string;
  label: string;
}

export interface TacticalMultiSelectProps {
  label: string;
  options: TacticalMultiSelectOption[];
  value: (number | string)[];
  onChange: (value: (number | string)[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const TacticalMultiSelect: React.FC<TacticalMultiSelectProps> = ({
  label,
  options,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select options...'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (optionValue: number | string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter(v => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const getSelectedLabels = () => {
    if (value.length === 0) return placeholder;
    return options
      .filter(opt => value.includes(opt.value))
      .map(opt => opt.label)
      .join(', ');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
        {label}
      </label>

      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className="w-full px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-sm text-left focus:outline-none focus:border-tactical-accent-orange disabled:opacity-50 flex justify-between items-center"
        >
          <span className={value.length === 0 ? 'text-tactical-text-dim' : ''}>
            {getSelectedLabels()}
          </span>
          <span className="ml-2">
            {isOpen ? '▲' : '▼'}
          </span>
        </button>

        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-tactical-bg-secondary border border-tactical-border-medium max-h-60 overflow-y-auto tactical-scrollbar">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-tactical-text-dim font-mono">
                No options available
              </div>
            ) : (
              options.map(option => (
                <label
                  key={option.value}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-tactical-bg-tertiary transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={value.includes(option.value)}
                    onChange={() => toggleOption(option.value)}
                    className="w-4 h-4 bg-tactical-bg-tertiary border border-tactical-border-medium text-tactical-accent-orange focus:ring-tactical-accent-orange focus:ring-2"
                  />
                  <span className="text-sm text-tactical-text-primary font-mono">
                    {option.label}
                  </span>
                </label>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
