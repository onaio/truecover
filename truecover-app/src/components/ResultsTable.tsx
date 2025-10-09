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
        <p className="text-tactical-accent-red font-mono text-xs mb-3">
          No features found in response. Showing raw JSON:
        </p>
        <textarea
          value={resultText}
          readOnly
          className="w-full h-[350px] p-3 font-mono text-xs bg-tactical-bg-secondary border border-tactical-border-medium text-tactical-text-secondary focus:outline-none focus:border-tactical-accent-red resize-y tactical-scrollbar"
        />
      </div>
    );
  }

  // Get all unique property keys for table headers
  const propertyKeys = new Set<string>();
  features.forEach((feature: any) => {
    if (feature.properties) {
      Object.keys(feature.properties).forEach(key => {
        // Hide bbox and sources columns
        if (key !== 'bbox' && key !== 'sources') {
          propertyKeys.add(key);
        }
      });
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
    <div className="w-full h-[400px] overflow-auto tactical-scrollbar border border-tactical-border-medium bg-tactical-bg-secondary">
      <table className="tactical-table text-tactical-text-secondary">
        <thead>
          <tr className="sticky top-0 z-10">
            <th className="bg-tactical-bg-secondary">ID</th>
            <th className="bg-tactical-bg-secondary">Coordinates</th>
            {headers.map(header => (
              <th key={header} className="bg-tactical-bg-secondary">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.map((feature: any, index: number) => {
            const selectedValue = feature.properties?.adaptively_selected;

            // Check if selected (handle both number and string values)
            // Convert to number and check if >= 0.5 (to catch 1.0, 1.000000, etc)
            let isSelected = false;
            if (selectedValue !== undefined && selectedValue !== null) {
              const numValue = typeof selectedValue === 'string' ? parseFloat(selectedValue) : Number(selectedValue);
              isSelected = !isNaN(numValue) && numValue >= 0.5;
            }

            const rowClasses = isSelected
              ? '!text-tactical-accent-green border-l-4 border-l-tactical-accent-green !font-bold'
              : '';

            const coords = feature.geometry?.coordinates || [];
            const coordString = coords.length >= 2
              ? `[${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}]`
              : 'N/A';

            return (
              <tr key={index} className={rowClasses}>
                <td>{feature.id || index + 1}</td>
                <td>{coordString}</td>
                {headers.map(header => {
                  // Calculate prevalence for rows with survey data
                  if (header === 'prevalence') {
                    const nTrials = feature.properties?.n_trials;
                    const nPositive = feature.properties?.n_positive;
                    if (nTrials !== undefined && nTrials !== null && nTrials > 0 &&
                        nPositive !== undefined && nPositive !== null) {
                      const prevalence = Number(nPositive) / Number(nTrials);
                      return (
                        <td key={header}>
                          {prevalence.toFixed(2)}
                        </td>
                      );
                    }
                    return <td key={header}></td>;
                  }

                  return (
                    <td key={header}>
                      {feature.properties?.[header] !== undefined && feature.properties?.[header] !== null
                        ? (typeof feature.properties[header] === 'number'
                            ? (header === 'id' || header === 'n_trials' || header === 'n_positive' || header === 'adaptively_selected'
                                ? Math.round(feature.properties[header])
                                : feature.properties[header].toFixed(2))
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

export default ResultsTable;