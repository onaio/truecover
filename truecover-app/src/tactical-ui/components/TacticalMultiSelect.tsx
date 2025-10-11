import React, { useState, useRef, useEffect } from 'react';

export interface TacticalMultiSelectOption {
  value: number | string;
  label: string;
}

export interface TacticalMultiSelectProps {
  label?: string;
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
  const [pendingValue, setPendingValue] = useState<(number | string)[]>(value);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Update pending value when value prop changes
  useEffect(() => {
    setPendingValue(value);
  }, [value]);

  // Apply changes and close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        if (isOpen) {
          onChange(pendingValue);
          setIsOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, pendingValue, onChange]);

  const toggleOption = (optionValue: number | string) => {
    // Special handling for "all" option
    if (optionValue === 'all') {
      // If "all" is being selected, clear all other selections
      if (!pendingValue.includes('all')) {
        setPendingValue(['all']);
      } else {
        // If "all" is being deselected, just remove it
        setPendingValue(pendingValue.filter(v => v !== 'all'));
      }
    } else {
      // For regular options, remove "all" if it's present
      let newValue = pendingValue.filter(v => v !== 'all');

      if (newValue.includes(optionValue)) {
        newValue = newValue.filter(v => v !== optionValue);
      } else {
        newValue = [...newValue, optionValue];
      }

      setPendingValue(newValue);
    }
  };

  const applyChanges = () => {
    onChange(pendingValue);
    setIsOpen(false);
  };

  const getSelectedLabels = () => {
    if (value.length === 0) return placeholder;
    return options
      .filter(opt => value.includes(opt.value))
      .map(opt => opt.label)
      .join(', ');
  };

  return (
    <div className="flex items-start gap-2">
      <div className="relative flex-1" ref={dropdownRef}>
        {label && (
          <label className="block text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
            {label}
          </label>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            className="w-full px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-base text-left focus:outline-none focus:border-tactical-accent-orange disabled:opacity-50 flex justify-between items-center"
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
                <div className="px-3 py-2 text-base text-tactical-text-dim font-mono">
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
                      checked={pendingValue.includes(option.value)}
                      onChange={() => toggleOption(option.value)}
                      className="w-4 h-4 bg-tactical-bg-tertiary border border-tactical-border-medium text-tactical-accent-orange focus:ring-tactical-accent-orange focus:ring-2"
                    />
                    <span className="text-base text-tactical-text-primary font-mono">
                      {option.label}
                    </span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={applyChanges}
        disabled={disabled}
        className="px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-base hover:bg-tactical-bg-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ marginTop: label ? '32px' : '0' }}
      >
        Go
      </button>
    </div>
  );
};
