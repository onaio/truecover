import React from 'react';
import { TacticalBadge } from '../tactical-ui';

interface LocationsTableProps {
  locations: any;
  onDeleteLocation?: (locationId: string) => void;
}

const LocationsTable: React.FC<LocationsTableProps> = ({ locations, onDeleteLocation }) => {
  const features = locations?.features || [];

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

  // Get all unique property keys for table headers
  const propertyKeys = new Set<string>();
  features.forEach((feature: any) => {
    if (feature.properties) {
      Object.keys(feature.properties).forEach(key => {
        // Exclude system properties that shouldn't be in the table
        if (!['id', 'latitude', 'longitude', 'external_id'].includes(key)) {
          propertyKeys.add(key);
        }
      });
    }
  });

  // Define preferred column order
  const columnOrder = [
    'n_trials',
    'n_positive',
    'prevalence',
    'prevalence_prediction',
    'prevalence_bci_width',
    'exceedance_probability',
    'exceedance_uncertainty',
    'adaptively_selected',
  ];

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
            <th className="bg-tactical-bg-secondary">External ID</th>
            <th className="bg-tactical-bg-secondary">Coordinates</th>
            {headers.map(header => (
              <th key={header} className="bg-tactical-bg-secondary">
                {header.replace(/_/g, ' ')}
              </th>
            ))}
            {onDeleteLocation && (
              <th className="bg-tactical-bg-secondary">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {features.map((feature: any, index: number) => {
            const selectedValue = feature.properties?.adaptively_selected;

            // Check if selected (handle both number and string values)
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

            const externalId = feature.properties?.external_id || '-';
            const displayExternalId = typeof externalId === 'string' && externalId.length > 12
              ? `${externalId.substring(0, 12)}...`
              : externalId;

            return (
              <tr key={feature.id || index} className={rowClasses}>
                <td title={externalId}>{displayExternalId}</td>
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

                  const value = feature.properties?.[header];

                  return (
                    <td key={header}>
                      {value !== undefined && value !== null
                        ? (typeof value === 'number'
                            ? (header === 'n_trials' || header === 'n_positive' || header === 'adaptively_selected'
                                ? Math.round(value)
                                : value.toFixed(2))
                            : String(value))
                      : ''}
                    </td>
                  );
                })}
                {onDeleteLocation && (
                  <td>
                    <button
                      onClick={() => onDeleteLocation(feature.id)}
                      className="text-tactical-accent-red hover:text-tactical-accent-orange text-xs font-mono font-bold uppercase px-2 py-1 border border-tactical-accent-red hover:border-tactical-accent-orange transition-colors"
                      title="Delete location"
                    >
                      Delete
                    </button>
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
