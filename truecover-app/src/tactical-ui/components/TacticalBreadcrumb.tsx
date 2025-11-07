// ABOUTME: Tactical-themed breadcrumb navigation component
// ABOUTME: Provides hierarchical navigation with monospace styling
import React from 'react';
import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  /**
   * Display label for the breadcrumb item
   */
  label: string;
  /**
   * URL to navigate to when clicked (optional for last item)
   */
  href?: string;
}

export interface TacticalBreadcrumbProps {
  /**
   * Array of breadcrumb items
   */
  items: BreadcrumbItem[];
  /**
   * Separator between items
   * @default "/"
   */
  separator?: string;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * TacticalBreadcrumb - Breadcrumb navigation component
 *
 * @example
 * <TacticalBreadcrumb
 *   items={[
 *     { label: 'Home', href: '/' },
 *     { label: 'Organizations', href: '/organizations' },
 *     { label: 'Settings' }
 *   ]}
 * />
 */
export const TacticalBreadcrumb: React.FC<TacticalBreadcrumbProps> = ({
  items,
  separator = '/',
  className = '',
}) => {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`font-mono text-sm ${className}`}
    >
      <ol className="flex items-center space-x-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={index} className="flex items-center">
              {item.href && !isLast ? (
                <Link
                  to={item.href}
                  className="text-tactical-accent hover:text-tactical-accent-hover transition-colors uppercase tracking-wide"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="text-tactical-text-muted uppercase tracking-wide">
                  {item.label}
                </span>
              )}

              {!isLast && (
                <span className="mx-2 text-tactical-text-muted">
                  {separator}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default TacticalBreadcrumb;
