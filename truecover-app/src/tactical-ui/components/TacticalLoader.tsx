import React, { useState, useEffect } from 'react';

interface TacticalLoaderProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}

const TacticalLoader: React.FC<TacticalLoaderProps> = ({
  size = 'md',
  color = 'text-white'
}) => {
  const [visibleLines, setVisibleLines] = useState(0);

  const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-24 h-24',
    lg: 'w-32 h-32'
  };

  const sizes = {
    sm: 64,
    md: 96,
    lg: 128
  };

  const circleSize = sizes[size];
  const centerX = circleSize / 2;
  const centerY = circleSize / 2;
  const lineCount = 16;
  const lineLength = circleSize * 0.15;
  const radius = circleSize * 0.35;

  // Generate lines
  const lines = Array.from({ length: lineCount }, (_, i) => {
    const angle = (i / lineCount) * Math.PI * 2 - Math.PI / 2; // Start from top
    const startX = centerX + Math.cos(angle) * (radius - lineLength);
    const startY = centerY + Math.sin(angle) * (radius - lineLength);
    const endX = centerX + Math.cos(angle) * radius;
    const endY = centerY + Math.sin(angle) * radius;

    return { startX, startY, endX, endY };
  });

  // Animate lines appearing incrementally
  useEffect(() => {
    const interval = setInterval(() => {
      setVisibleLines(prev => {
        if (prev >= lineCount) {
          return 1; // Reset to 1 after all lines are shown
        }
        return prev + 1;
      });
    }, 80); // Add a line every 80ms

    return () => clearInterval(interval);
  }, [lineCount]);

  return (
    <div className={`relative ${sizeClasses[size]} ${color}`}>
      <svg
        width={circleSize}
        height={circleSize}
        viewBox={`0 0 ${circleSize} ${circleSize}`}
      >
        {/* Radial lines - only show up to visibleLines */}
        {lines.map((line, i) => (
          <line
            key={i}
            x1={line.startX}
            y1={line.startY}
            x2={line.endX}
            y2={line.endY}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            opacity={i < visibleLines ? 1 : 0}
            style={{
              transition: 'opacity 0.1s ease-in-out'
            }}
          />
        ))}

        {/* Center circle */}
        <circle
          cx={centerX}
          cy={centerY}
          r={circleSize * 0.08}
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    </div>
  );
};

export default TacticalLoader;
