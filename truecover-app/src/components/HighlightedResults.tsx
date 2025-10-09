import React, { useMemo } from 'react';

interface HighlightedResultsProps {
  resultText: string;
}

const HighlightedResults: React.FC<HighlightedResultsProps> = ({ resultText }) => {
  const renderHighlightedJson = useMemo(() => {
    try {
      // Parse the JSON to ensure it's valid
      const data = JSON.parse(resultText);
      
      // Re-stringify with proper formatting
      const formattedJson = JSON.stringify(data, null, 2);
      const lines = formattedJson.split('\n');
      
      // First pass: identify which lines belong to selected features
      const selectedLineRanges: Array<[number, number]> = [];
      let currentFeatureStart = -1;
      let braceCount = 0;
      let isInFeature = false;
      let isSelectedFeature = false;
      
      lines.forEach((line, index) => {
        // Count braces
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        
        // Check if we're starting a feature
        if (line.includes('"type": "Feature"')) {
          currentFeatureStart = index;
          // Find the opening brace of this feature (go backwards)
          for (let i = index; i >= 0; i--) {
            if (lines[i].includes('{')) {
              currentFeatureStart = i;
              break;
            }
          }
          isInFeature = true;
          braceCount = 1; // Reset brace count for this feature
          isSelectedFeature = false;
        } else if (isInFeature) {
          braceCount += openBraces - closeBraces;
        }
        
        // Check if this feature is selected
        if (isInFeature && (line.includes('"adaptively_selected": 1') || 
            line.includes('"adaptively_selected": true'))) {
          isSelectedFeature = true;
        }
        
        // Check if we're ending a feature
        if (isInFeature && braceCount === 0) {
          if (isSelectedFeature && currentFeatureStart !== -1) {
            selectedLineRanges.push([currentFeatureStart, index]);
          }
          isInFeature = false;
          isSelectedFeature = false;
          currentFeatureStart = -1;
        }
      });
      
      // Second pass: render with highlighting
      return lines.map((line, index) => {
        // Check if this line is in a selected feature range
        const isInSelectedRange = selectedLineRanges.some(
          ([start, end]) => index >= start && index <= end
        );
        
        if (isInSelectedRange) {
          return (
            <div
              key={index}
              style={{
                backgroundColor: '#cfe2ff',
                color: '#0a58ca',
                fontWeight: line.includes('adaptively_selected') ? 'bold' : 'normal',
                borderLeft: '3px solid #0d6efd',
                paddingLeft: '7px',
                marginLeft: '-10px',
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap'
              }}
            >
              {line}
            </div>
          );
        }
        
        return (
          <div 
            key={index} 
            style={{ 
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap'
            }}
          >
            {line}
          </div>
        );
      });
    } catch (e) {
      console.error('Error parsing JSON:', e);
      // If parsing fails, just show the raw text with basic formatting
      return resultText.split('\n').map((line, index) => (
        <div 
          key={index}
          style={{ 
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap'
          }}
        >
          {line}
        </div>
      ));
    }
  }, [resultText]);

  return (
    <div
      style={{
        width: '100%',
        height: '400px',
        padding: '10px',
        fontFamily: 'monospace',
        fontSize: '12px',
        backgroundColor: 'white',
        border: '1px solid #ccc',
        borderRadius: '4px',
        overflow: 'auto',
        lineHeight: '1.5'
      }}
    >
      {renderHighlightedJson}
    </div>
  );
};

export default HighlightedResults;