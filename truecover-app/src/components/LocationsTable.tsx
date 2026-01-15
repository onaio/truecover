import React from 'react';
import { TacticalButton } from '../tactical-ui';

interface LocationsTableProps {
  locations: any;
  onEditLocation?: (location: any) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

const LocationsTable: React.FC<LocationsTableProps> = ({
  locations,
  onEditLocation,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false
}) => {
  const locationList = locations?.locations || [];

  // Handle scroll to bottom for infinite loading
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!onLoadMore || !hasMore || isLoadingMore) return;

    const target = e.currentTarget;
    const scrolledToBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 100;

    if (scrolledToBottom) {
      onLoadMore();
    }
  };

  if (locationList.length === 0) {
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
    { key: 'id', label: 'ID' },
    { key: 'quadkey', label: 'Quadkey' },
    { key: 'external_id', label: 'External ID' },
    { key: 'latitude', label: 'Latitude' },
    { key: 'longitude', label: 'Longitude' },
  ];

  return (
    <div
      className="w-full h-[400px] overflow-auto tactical-scrollbar border border-tactical-border-medium bg-tactical-bg-secondary"
      onScroll={handleScroll}
    >
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
          {locationList.map((location: any, index: number) => {
            return (
              <tr key={location.id || index}>
                {headers.map(header => {
                  const value = location[header.key];

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

                  // Truncate long IDs for display (but not quadkey)
                  if ((header.key === 'id' || header.key === 'external_id') && displayValue.length > 12) {
                    return (
                      <td key={header.key} title={displayValue}>
                        {displayValue.substring(0, 12)}...
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
                      onClick={() => onEditLocation(location)}
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
      {isLoadingMore && (
        <div className="py-4 text-center text-tactical-text-dim">
          Loading more locations...
        </div>
      )}
    </div>
  );
};

export default LocationsTable;
