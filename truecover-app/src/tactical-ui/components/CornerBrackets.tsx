import React from 'react';

export interface CornerBracketsProps {
  /**
   * Color of the corner brackets
   * @default 'text-tactical-border-light'
   */
  color?: string;
  /**
   * Size of the brackets in pixels
   * @default 12
   */
  size?: number;
  /**
   * Show all four corners
   * @default true
   */
  showAll?: boolean;
  /**
   * Show specific corners
   */
  corners?: {
    topLeft?: boolean;
    topRight?: boolean;
    bottomLeft?: boolean;
    bottomRight?: boolean;
  };
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * CornerBrackets - Decorative L-shaped corners for tactical UI elements
 *
 * @example
 * <div className="relative p-4">
 *   <CornerBrackets />
 *   Content here
 * </div>
 */
export const CornerBrackets: React.FC<CornerBracketsProps> = ({
  color = 'text-tactical-border-light',
  size = 12,
  showAll = true,
  corners,
  className = '',
}) => {
  const showTopLeft = showAll || corners?.topLeft;
  const showTopRight = showAll || corners?.topRight;
  const showBottomLeft = showAll || corners?.bottomLeft;
  const showBottomRight = showAll || corners?.bottomRight;

  return (
    <>
      {/* Top-left */}
      {showTopLeft && (
        <div
          className={`absolute pointer-events-none ${color} ${className}`}
          style={{
            top: -1,
            left: -1,
            width: size,
            height: size,
            borderTop: '1px solid currentColor',
            borderLeft: '1px solid currentColor',
          }}
        />
      )}

      {/* Top-right */}
      {showTopRight && (
        <div
          className={`absolute pointer-events-none ${color} ${className}`}
          style={{
            top: -1,
            right: -1,
            width: size,
            height: size,
            borderTop: '1px solid currentColor',
            borderRight: '1px solid currentColor',
          }}
        />
      )}

      {/* Bottom-left */}
      {showBottomLeft && (
        <div
          className={`absolute pointer-events-none ${color} ${className}`}
          style={{
            bottom: -1,
            left: -1,
            width: size,
            height: size,
            borderBottom: '1px solid currentColor',
            borderLeft: '1px solid currentColor',
          }}
        />
      )}

      {/* Bottom-right */}
      {showBottomRight && (
        <div
          className={`absolute pointer-events-none ${color} ${className}`}
          style={{
            bottom: -1,
            right: -1,
            width: size,
            height: size,
            borderBottom: '1px solid currentColor',
            borderRight: '1px solid currentColor',
          }}
        />
      )}
    </>
  );
};

export default CornerBrackets;
