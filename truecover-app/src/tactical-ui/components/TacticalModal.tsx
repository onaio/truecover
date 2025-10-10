import React, { useEffect } from 'react';
import { CornerBrackets } from './CornerBrackets';

export interface TacticalModalProps {
  /**
   * Modal content
   */
  children: React.ReactNode;
  /**
   * Modal title
   */
  title: string;
  /**
   * Whether the modal is open
   */
  isOpen: boolean;
  /**
   * Close handler
   */
  onClose: () => void;
  /**
   * Modal width
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * TacticalModal - A modal dialog with tactical styling
 */
export const TacticalModal: React.FC<TacticalModalProps> = ({
  children,
  title,
  isOpen,
  onClose,
  size = 'md',
  className = ''
}) => {
  // Handle ESC key press
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className={`relative w-full ${sizeClasses[size]} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-tactical-bg-primary border border-tactical-border-medium">
          {/* Corner Brackets */}
          <CornerBrackets size="md" />

          {/* Header */}
          <div className="border-b border-tactical-border-medium p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-lg font-bold text-tactical-text-primary uppercase tracking-wider">
                {title}
              </h3>
              <button
                onClick={onClose}
                className="text-tactical-text-muted hover:text-tactical-text-primary transition-colors font-mono text-xl leading-none"
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
