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
  autoApply?: boolean;
}

export const TacticalMultiSelect: React.FC<TacticalMultiSelectProps> = ({
  label,
  options,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select options...',
  autoApply = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<(number | string)[]>(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Update pending value when value prop changes
  useEffect(() => {
    setPendingValue(value);
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (isOpen) {
          setIsOpen(false);
          // Reset pending value to current value when closing without applying (only in non-autoApply mode)
          if (!autoApply) {
            setPendingValue(value);
          }
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, value, autoApply]);

  const toggleOption = (optionValue: number | string) => {
    let newValue: (number | string)[];

    console.log('[TacticalMultiSelect] toggleOption called with:', optionValue);
    console.log('[TacticalMultiSelect] current pendingValue:', pendingValue);

    // Simple toggle logic:
    // - "all" is mutually exclusive with specific options
    // - Clicking "all" selects only "all"
    // - Clicking a specific option when "all" is selected switches to that option
    // - Clicking a specific option otherwise toggles it

    if (optionValue === 'all') {
      // Toggle "all" - if selected, deselect; if not, select only "all"
      if (pendingValue.includes('all')) {
        newValue = [];
      } else {
        newValue = ['all'];
      }
    } else {
      // Clicking a specific option
      if (pendingValue.includes('all')) {
        // Switch from "all" to just this specific option
        newValue = [optionValue];
      } else if (pendingValue.includes(optionValue)) {
        // Deselect this option
        newValue = pendingValue.filter(v => v !== optionValue);
      } else {
        // Add this option
        newValue = [...pendingValue, optionValue];
      }
    }

    console.log('[TacticalMultiSelect] Setting new value:', newValue);
    setPendingValue(newValue);

    // In autoApply mode, immediately call onChange
    if (autoApply) {
      console.log('[TacticalMultiSelect] Auto-applying onChange with:', newValue);
      onChange(newValue);
    }
  };

  // Check if an option should appear checked
  const isOptionChecked = (optionValue: number | string) => {
    if (pendingValue.includes('all')) {
      // When "all" is selected, all options appear checked
      return true;
    }
    return pendingValue.includes(optionValue);
  };

  const applyChanges = () => {
    onChange(pendingValue);
    setIsOpen(false);
  };

  const getSelectedLabels = () => {
    // In autoApply mode, value is always current; otherwise show pending when open
    const displayValue = autoApply ? value : (isOpen ? pendingValue : value);

    if (displayValue.length === 0) return placeholder;

    const selectedOptions = options.filter(opt => displayValue.includes(opt.value));

    // If "all" is selected, just show that option's label
    if (displayValue.includes('all')) {
      const allOption = selectedOptions.find(opt => opt.value === 'all');
      return allOption?.label || placeholder;
    }

    // If only one option is selected, show its full label
    if (selectedOptions.length === 1) {
      return selectedOptions[0].label;
    }

    // If multiple options are selected, show count
    return `${selectedOptions.length} selected`;
  };

  return (
    <div className="flex items-start gap-2" ref={containerRef}>
      <div className="relative flex-1">
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
                  <div
                    key={option.value}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-tactical-bg-tertiary transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOption(option.value);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isOptionChecked(option.value)}
                      onChange={() => {}} // Handled by div onClick
                      className="w-4 h-4 bg-tactical-bg-tertiary border border-tactical-border-medium text-tactical-accent-orange focus:ring-tactical-accent-orange focus:ring-2 pointer-events-none"
                    />
                    <span className="text-base text-tactical-text-primary font-mono">
                      {option.label}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {!autoApply && (
        <button
          type="button"
          onClick={applyChanges}
          disabled={disabled}
          className="px-3 py-2 bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-primary font-mono text-base hover:bg-tactical-bg-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ marginTop: label ? '32px' : '0' }}
        >
          Go
        </button>
      )}
    </div>
  );
};
