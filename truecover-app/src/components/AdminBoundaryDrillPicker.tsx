// ABOUTME: Drill-down picker from division through whatever admin boundary levels exist
// ABOUTME: Follows the branch the data actually has - upazila/union or city corporation/zone/ward/block

import React, { useState } from 'react';
import { TacticalModal, TacticalButton } from '../tactical-ui';
import { useAdminBoundaryChildren } from '../hooks/useAdminBoundaries';

interface BoundaryStep {
  id: string;
  name: string;
}

interface AdminBoundaryDrillPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (boundary: { id: string; name: string }) => void;
}

export const AdminBoundaryDrillPicker: React.FC<AdminBoundaryDrillPickerProps> = ({
  isOpen,
  onClose,
  onSelect,
}) => {
  const [path, setPath] = useState<BoundaryStep[]>([]);

  const currentIdentifier = path.length > 0 ? path[path.length - 1].id : 'BD';
  const { data: children, isLoading } = useAdminBoundaryChildren(isOpen ? currentIdentifier : undefined);

  const handleDrillInto = (child: { id: string; name: string }) => {
    setPath(prev => [...prev, child]);
  };

  const handleBreadcrumbClick = (index: number) => {
    setPath(prev => prev.slice(0, index + 1));
  };

  const handleSelect = (child: { id: string; name: string }) => {
    onSelect(child);
    setPath([]);
    onClose();
  };

  const handleClose = () => {
    setPath([]);
    onClose();
  };

  return (
    <TacticalModal title="Select Admin Boundary" isOpen={isOpen} onClose={handleClose} size="md">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1 text-xs font-mono text-tactical-text-dim">
          <span className="cursor-pointer hover:text-tactical-text-primary" onClick={() => setPath([])}>
            Bangladesh
          </span>
          {path.map((step, idx) => (
            <React.Fragment key={step.id}>
              <span>/</span>
              <span
                className="cursor-pointer hover:text-tactical-text-primary"
                onClick={() => handleBreadcrumbClick(idx)}
              >
                {step.name}
              </span>
            </React.Fragment>
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm font-mono text-tactical-text-muted">Loading...</p>
        ) : !children || children.length === 0 ? (
          <p className="text-sm font-mono text-tactical-text-muted">No sub-areas found at this level.</p>
        ) : (
          <div className="border border-tactical-border-medium max-h-80 overflow-y-auto">
            {children.map((child) => (
              <div
                key={child.id}
                className="flex items-center justify-between px-3 py-2 border-b border-tactical-border-dark last:border-b-0 hover:bg-tactical-bg-secondary"
              >
                <span className="text-sm font-mono text-tactical-text-primary">{child.name}</span>
                <div className="flex gap-2">
                  <TacticalButton size="sm" variant="secondary" onClick={() => handleDrillInto(child)}>
                    Drill In
                  </TacticalButton>
                  <TacticalButton size="sm" variant="primary" onClick={() => handleSelect(child)}>
                    Use This
                  </TacticalButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TacticalModal>
  );
};
