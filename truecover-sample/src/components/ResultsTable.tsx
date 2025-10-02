import React from 'react';

interface ResultsTableProps {
  resultText: string;
}

const ResultsTable: React.FC<ResultsTableProps> = ({ resultText }) => {
  const parseResults = () => {
    try {
      const data = JSON.parse(resultText);

      // Try different paths to find features
      let features = [];
      if (data.features) {
        features = data.features;
      } else if (data.result?.features) {
        features = data.result.features;
      } else if (Array.isArray(data)) {
        features = data;
      }

      return features;
    } catch (e) {
      console.error('Error parsing results:', e);
      return [];
    }
  };

  const features = parseResults();

  if (features.length === 0) {
    return (
      <div>
        <p style={{ color: 'red', marginBottom: '10px' }}>
          No features found in response. Showing raw JSON:
        </p>
        <textarea
          value={resultText}
          readOnly
          style={{
            width: '100%',
            height: '350px',
            padding: '10px',
            fontFamily: 'monospace',
            fontSize: '12px',
            backgroundColor: 'white',
            border: '1px solid #ccc',
            borderRadius: '4px',
            resize: 'vertical'
          }}
        />
      </div>
    );
  }

  // Get all unique property keys for table headers
  const propertyKeys = new Set<string>();
  features.forEach((feature: any) => {
    if (feature.properties) {
      Object.keys(feature.properties).forEach(key => propertyKeys.add(key));
    }
  });

  // Define preferred column order
  const columnOrder = [
    'id',
    'n_trials',
    'n_positive',
    'prevalence',
    'prevalence_prediction',
    'prevalence_bci_width',
    'exceedance_probability',
    'exceedance_uncertainty',
  ];

  // Add 'prevalence' as a calculated column
  propertyKeys.add('prevalence');

  // Sort headers by preferred order
  const headers = Array.from(propertyKeys).sort((a, b) => {
    const aIndex = columnOrder.indexOf(a);
    const bIndex = columnOrder.indexOf(b);

    // If both are in preferred order, sort by that order
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }

    // If only one is in preferred order, it comes first
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    // Otherwise, alphabetical
    return a.localeCompare(b);
  });

  return (
    <div style={{ width: '100%', height: '400px', overflow: 'auto' }}>
      <table style={{ 
        width: '100%', 
        borderCollapse: 'collapse',
        fontFamily: 'monospace',
        fontSize: '12px'
      }}>
        <thead>
          <tr style={{ 
            backgroundColor: '#f8f9fa',
            position: 'sticky',
            top: 0,
            zIndex: 10
          }}>
            <th style={headerStyle}>ID</th>
            <th style={headerStyle}>Coordinates</th>
            {headers.map(header => (
              <th key={header} style={headerStyle}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.map((feature: any, index: number) => {
            const isSelected = feature.properties?.adaptively_selected === 1 || 
                             feature.properties?.adaptively_selected === true;
            
            const rowStyle: React.CSSProperties = {
              backgroundColor: isSelected ? '#cfe2ff' : (index % 2 === 0 ? 'white' : '#f8f9fa'),
              color: isSelected ? '#0a58ca' : 'inherit',
              fontWeight: isSelected ? 'bold' : 'normal',
              borderLeft: isSelected ? '4px solid #0d6efd' : 'none'
            };

            const coords = feature.geometry?.coordinates || [];
            const coordString = coords.length >= 2 
              ? `[${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}]`
              : 'N/A';

            return (
              <tr key={index} style={rowStyle}>
                <td style={cellStyle}>{index + 1}</td>
                <td style={cellStyle}>{coordString}</td>
                {headers.map(header => {
                  // Calculate prevalence for rows with survey data
                  if (header === 'prevalence') {
                    const nTrials = feature.properties?.n_trials;
                    const nPositive = feature.properties?.n_positive;
                    if (nTrials !== undefined && nTrials !== null && nTrials > 0 &&
                        nPositive !== undefined && nPositive !== null) {
                      const prevalence = Number(nPositive) / Number(nTrials);
                      return (
                        <td key={header} style={cellStyle}>
                          {prevalence.toFixed(2)}
                        </td>
                      );
                    }
                    return <td key={header} style={cellStyle}></td>;
                  }

                  return (
                    <td key={header} style={{
                      ...cellStyle,
                      backgroundColor: isSelected && header === 'adaptively_selected'
                        ? '#0d6efd'
                        : undefined,
                      color: isSelected && header === 'adaptively_selected'
                        ? 'white'
                        : undefined
                    }}>
                      {feature.properties?.[header] !== undefined && feature.properties?.[header] !== null
                        ? (typeof feature.properties[header] === 'number'
                            ? (header === 'id' || header === 'n_trials' || header === 'n_positive'
                                ? Math.round(feature.properties[header])
                                : feature.properties[header].toFixed(6))
                            : String(feature.properties[header]))
                      : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const headerStyle: React.CSSProperties = {
  padding: '8px',
  textAlign: 'left',
  borderBottom: '2px solid #dee2e6',
  backgroundColor: '#f8f9fa',
  fontWeight: 'bold',
  whiteSpace: 'nowrap'
};

const cellStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #dee2e6',
  whiteSpace: 'nowrap'
};

export default ResultsTable;