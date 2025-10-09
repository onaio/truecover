import React from 'react';

export interface TacticalTableColumn {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

export interface TacticalTableProps {
  /**
   * Table columns configuration
   */
  columns: TacticalTableColumn[];
  /**
   * Table data rows
   */
  data: any[];
  /**
   * Enable row hover effect
   * @default true
   */
  hoverable?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Row click handler
   */
  onRowClick?: (row: any, index: number) => void;
}

/**
 * TacticalTable - Monospace data table with tactical styling
 *
 * @example
 * <TacticalTable
 *   columns={[
 *     { key: 'id', label: 'ID' },
 *     { key: 'name', label: 'Name' },
 *     { key: 'status', label: 'Status' }
 *   ]}
 *   data={missions}
 * />
 */
export const TacticalTable: React.FC<TacticalTableProps> = ({
  columns,
  data,
  hoverable = true,
  className = '',
  onRowClick,
}) => {
  return (
    <div className={`overflow-x-auto tactical-scrollbar ${className}`}>
      <table className="tactical-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{ textAlign: column.align || 'left' }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr
              key={index}
              className={`
                ${hoverable ? 'cursor-pointer' : ''}
                ${onRowClick ? 'cursor-pointer' : ''}
              `}
              onClick={() => onRowClick?.(row, index)}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={{ textAlign: column.align || 'left' }}
                >
                  {column.render
                    ? column.render(row[column.key], row)
                    : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TacticalTable;
