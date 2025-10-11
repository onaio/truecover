import React from 'react';
import { TacticalBadge, TacticalButton } from '../tactical-ui';

interface LocationsTableProps {
  locations: any;
  onEditLocation?: (location: any) => void;
}

const LocationsTable: React.FC<LocationsTableProps> = ({ locations, onEditLocation }) => {
  const features = locations?.features || [];

  // Debug: Log a sample feature to see what data we're getting
  if (features.length > 0) {
    console.log('LocationsTable - Sample feature:', features[0]);
    console.log('LocationsTable - Sample feature.properties:', features[0].properties);
    console.log('LocationsTable - Sample rounds value:', features[0].properties?.rounds);
  }

  if (features.length === 0) {
    return (
      <div className="w-full h-[400px] flex items-center justify-center border border-tactical-border-medium bg-tactical-bg-secondary">
        <div className="text-center">
          <p className="text-tactical-text-dim font-mono text-sm mb-2">
            No locations found
          </p>
          <p className="text-tactical-text-dim font-mono text-xs">
            Upload a GeoJSON or CSV file to add locations
          </p>
        </div>
      </div>
    );
  }

  // Define the columns based on the locations table schema
  const headers = [
    { key: 'external_id', label: 'External ID' },
    { key: 'rounds', label: 'Rounds' },
    { key: 'latitude', label: 'Latitude' },
    { key: 'longitude', label: 'Longitude' },
    { key: 'exceedance_probability', label: 'Exceedance Probability' },
    { key: 'exceedance_uncertainty', label: 'Exceedance Uncertainty' },
    { key: 'prevalence_bci_width', label: 'Prevalence BCI Width' },
    { key: 'prevalence_prediction', label: 'Prevalence Prediction' },
  ];

  return (
    <div className="w-full h-[400px] overflow-auto tactical-scrollbar border border-tactical-border-medium bg-tactical-bg-secondary">
      <table className="tactical-table text-tactical-text-secondary">
        <thead>
          <tr className="sticky top-0 z-10">
            {headers.map(header => (
              <th key={header.key} className="bg-tactical-bg-secondary">
                {header.label}
              </th>
            ))}
            {onEditLocation && (
              <th className="bg-tactical-bg-secondary">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {features.map((feature: any, index: number) => {
            const props = feature.properties || {};
            const roundsValue = props.rounds;

            // Check if location has any rounds assigned
            let isSelected = false;
            let roundsArray: number[] = [];

            if (Array.isArray(roundsValue)) {
              roundsArray = roundsValue;
            } else if (typeof roundsValue === 'string') {
              try {
                const parsed = JSON.parse(roundsValue);
                if (Array.isArray(parsed)) {
                  roundsArray = parsed;
                }
              } catch {
                roundsArray = [];
              }
            }

            isSelected = roundsArray.length > 0;

            const rowClasses = isSelected
              ? '!text-tactical-accent-green border-l-4 border-l-tactical-accent-green !font-bold'
              : '';

            return (
              <tr key={feature.id || index} className={rowClasses}>
                {headers.map(header => {
                  const value = props[header.key];

                  // Special formatting for different field types
                  let displayValue = '';
                  if (value !== undefined && value !== null) {
                    if (typeof value === 'number') {
                      if (header.key === 'latitude' || header.key === 'longitude') {
                        displayValue = value.toFixed(6);
                      } else {
                        displayValue = value.toFixed(2);
                      }
                    } else {
                      displayValue = String(value);
                    }
                  }

                  // Truncate external_id if too long
                  if (header.key === 'external_id' && displayValue.length > 12) {
                    return (
                      <td key={header.key} title={displayValue}>
                        {displayValue.substring(0, 12)}...
                      </td>
                    );
                  }

                  // Special rendering for rounds array
                  if (header.key === 'rounds') {
                    // Handle rounds - could be array, string, or null
                    let roundsArray: number[] = [];
                    if (Array.isArray(value)) {
                      roundsArray = value;
                    } else if (typeof value === 'string') {
                      try {
                        // Try parsing if it's a JSON string like "[1,2]"
                        const parsed = JSON.parse(value);
                        if (Array.isArray(parsed)) {
                          roundsArray = parsed;
                        }
                      } catch {
                        // If parsing fails, treat as empty
                        roundsArray = [];
                      }
                    }

                    return (
                      <td key={header.key} className="text-center">
                        {roundsArray.length > 0 ? (
                          <div className="flex gap-1 flex-wrap justify-center">
                            {roundsArray.map((round) => (
                              <span
                                key={round}
                                className="inline-block px-2 py-0.5 text-xs font-mono text-tactical-accent-green border border-tactical-accent-green"
                              >
                                {round}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-tactical-text-dim">-</span>
                        )}
                      </td>
                    );
                  }

                  return (
                    <td key={header.key}>
                      {displayValue}
                    </td>
                  );
                })}
                {onEditLocation && (
                  <td>
                    <TacticalButton
                      variant="secondary"
                      size="sm"
                      onClick={() => onEditLocation(feature)}
                    >
                      Edit
                    </TacticalButton>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default LocationsTable;
