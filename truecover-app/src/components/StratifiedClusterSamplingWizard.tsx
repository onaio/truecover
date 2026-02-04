// ABOUTME: Three-step wizard for stratified cluster sampling round creation
// ABOUTME: Step 0: Select division/district, Step 1: Categorize areas, Step 2: Parameters, Step 3: Progress
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, closestCenter } from '@dnd-kit/core';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import {
  TacticalModal,
  TacticalButton,
  TacticalInput,
  TacticalSelect,
  tacticalToast,
} from '../tactical-ui';
import { DraggableAreaCard } from './DraggableAreaCard';
import { CategoryColumn } from './CategoryColumn';
import { useDivisions, useDistricts, useAdminBoundaryChildren } from '../hooks/useAdminBoundaries';
import { env } from '../config/env';

const API_URL = env.VITE_API_URL;

interface WorkflowProgress {
  status: string;
  selected_upazilas: number;
  selected_unions: number;
  child_workflows_started: number;
}

interface AdminBoundary {
  pcode: string;
  name: string;
  level: number;
  population: number;
}

interface Categories {
  high_risk: string[];
  low_risk: string[];
  hard_to_reach: string[];
  uncategorized: string[];
}

interface StratifiedClusterSamplingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  projectId: string;
  startingPcode?: string;
  startingName?: string;
  indicatorId: string;
  onRoundCreated: () => void;
  onSamplingWorkflowsStarted?: (areaWorkflowMap: Record<string, string>) => void;
  onGeneratingStarted?: () => void;
}

export const StratifiedClusterSamplingWizard: React.FC<
  StratifiedClusterSamplingWizardProps
> = ({
  isOpen,
  onClose,
  campaignId,
  projectId: _projectId,
  startingPcode: initialPcode,
  startingName: initialName,
  indicatorId,
  onRoundCreated,
  onSamplingWorkflowsStarted,
  onGeneratingStarted,
}) => {
  void _projectId;
  const { getToken } = useAuth();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Workflow tracking state
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<string>('');
  const [workflowProgress, setWorkflowProgress] = useState<WorkflowProgress | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowResult, setWorkflowResult] = useState<any>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Step 0 state - area selection
  const [selectedDivision, setSelectedDivision] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedDistrictName, setSelectedDistrictName] = useState('');

  // Step 1 state - categorization
  const [categories, setCategories] = useState<Categories>({
    high_risk: [],
    low_risk: [],
    hard_to_reach: [],
    uncategorized: [],
  });

  // Drag state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Step 2 state - parameters
  const [roundName, setRoundName] = useState('');
  const [upazilaCount, setUpazilaCount] = useState('3');
  const [unionsPerUpazila, setUnionsPerUpazila] = useState('2');
  const [pixelsPerUnion, setPixelsPerUnion] = useState('50');
  const [populationWeighted, setPopulationWeighted] = useState(false);
  const [minPopulation, setMinPopulation] = useState('');

  // React Query hooks for fetching admin boundaries
  const { data: divisions = [], isLoading: divisionsLoading } = useDivisions();
  const { data: districts = [], isLoading: districtsLoading } = useDistricts(
    selectedDivision || undefined
  );
  const { data: upazilas = [], isLoading: upazilasLoading } = useAdminBoundaryChildren(
    selectedDistrict || undefined
  );

  // Polling function for workflow status
  const pollWorkflowStatus = useCallback(async (wfId: string) => {
    try {
      const token = await getToken();
      const response = await axios.get(
        `${API_URL}/api/rounds/stratified-cluster/${wfId}/status`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = response.data;
      setWorkflowStatus(data.status);

      if (data.progress) {
        setWorkflowProgress(data.progress);
      }

      if (data.status === 'completed') {
        setWorkflowResult(data.result);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        tacticalToast.success('Stratified cluster sampling completed!');
        onRoundCreated();
        if (data.result?.area_workflow_map) {
          onSamplingWorkflowsStarted?.(data.result.area_workflow_map);
        }
      } else if (data.status === 'failed') {
        setWorkflowError(data.error || 'Workflow failed');
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        tacticalToast.error(data.error || 'Workflow failed');
      }
    } catch (error: any) {
      console.error('Error polling workflow status:', error);
    }
  }, [getToken, onRoundCreated]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // If we have an initial pcode, skip to step 1
      if (initialPcode) {
        setSelectedDistrict(initialPcode);
        setSelectedDistrictName(initialName || '');
        setStep(1);
      } else {
        setStep(0);
      }
    } else {
      // Reset all state when closed
      setStep(0);
      setSelectedDivision('');
      setSelectedDistrict('');
      setSelectedDistrictName('');
      setCategories({ high_risk: [], low_risk: [], hard_to_reach: [], uncategorized: [] });
      setRoundName('');
      // Reset workflow tracking state
      setWorkflowId(null);
      setWorkflowStatus('');
      setWorkflowProgress(null);
      setWorkflowError(null);
      setWorkflowResult(null);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
  }, [isOpen, initialPcode, initialName]);

  // Update categories when upazilas load
  useEffect(() => {
    if (upazilas.length > 0 && step === 1) {
      setCategories({
        high_risk: [],
        low_risk: [],
        hard_to_reach: [],
        uncategorized: upazilas.map((u) => u.pcode),
      });
    }
  }, [upazilas, step]);

  const handleDistrictSelect = (pcode: string) => {
    setSelectedDistrict(pcode);
    const district = districts.find(d => d.pcode === pcode);
    setSelectedDistrictName(district?.name || '');
  };

  const handleProceedToStep1 = () => {
    if (selectedDistrict) {
      setStep(1);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over) return;

    const draggedPcode = active.id as string;
    const targetCategory = over.id as keyof Categories;

    const newCategories = { ...categories };
    for (const cat of Object.keys(newCategories) as (keyof Categories)[]) {
      newCategories[cat] = newCategories[cat].filter((p) => p !== draggedPcode);
    }
    newCategories[targetCategory].push(draggedPcode);
    setCategories(newCategories);
  };

  const getAreaByPcode = (pcode: string): AdminBoundary | undefined =>
    upazilas.find((c) => c.pcode === pcode) as AdminBoundary | undefined;

  const canProceedStep1 = categories.uncategorized.length === 0;

  const estimatedPixels =
    parseInt(upazilaCount || '0') *
    parseInt(unionsPerUpazila || '0') *
    parseInt(pixelsPerUnion || '0');

  const handleSubmit = async () => {
    if (!roundName.trim()) {
      tacticalToast.error('Round name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await getToken();
      const response = await axios.post(
        `${API_URL}/api/campaigns/${campaignId}/rounds/stratified-cluster`,
        {
          name: roundName.trim(),
          starting_pcode: selectedDistrict,
          categories: {
            high_risk: categories.high_risk,
            low_risk: categories.low_risk,
            hard_to_reach: categories.hard_to_reach,
          },
          upazila_count: parseInt(upazilaCount),
          unions_per_upazila: parseInt(unionsPerUpazila),
          pixels_per_union: parseInt(pixelsPerUnion),
          population_weighted: populationWeighted,
          min_population: minPopulation ? parseInt(minPopulation) : null,
          indicator_id: indicatorId,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const wfId = response.data.workflow_id;
      setWorkflowId(wfId);
      setWorkflowStatus('running');
      setStep(3); // Move to progress view
      onGeneratingStarted?.();

      // Start polling for status
      pollingRef.current = setInterval(() => {
        pollWorkflowStatus(wfId);
      }, 2000);

      // Initial poll
      pollWorkflowStatus(wfId);

    } catch (error: any) {
      console.error('Error creating round:', error);
      tacticalToast.error(
        error.response?.data?.error || 'Failed to create round'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate population totals for each category
  const getPopulationForCategory = (pcodes: string[]): number => {
    return pcodes.reduce((sum, pcode) => {
      const area = getAreaByPcode(pcode);
      return sum + (area?.population || 0);
    }, 0);
  };

  // Use wider modal only for step 1 (categorization)
  const modalSize = step === 1 ? '2xl' : 'lg';

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={onClose}
      title="Stratified Round"
      size={modalSize}
    >
      {/* Step 0: Select Division and District */}
      {step === 0 && (
        <div>
          <div className="mb-6 text-zinc-300">
            Select the division and district to sample from.
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Division
              </label>
              {divisionsLoading ? (
                <div className="text-zinc-500">Loading divisions...</div>
              ) : (
                <TacticalSelect
                  value={selectedDivision}
                  onChange={setSelectedDivision}
                  options={divisions.map(d => ({ value: d.pcode, label: d.name }))}
                  placeholder="Select a division..."
                />
              )}
            </div>

            {selectedDivision && (
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">
                  District
                </label>
                {districtsLoading ? (
                  <div className="text-zinc-500">Loading districts...</div>
                ) : (
                  <TacticalSelect
                    value={selectedDistrict}
                    onChange={handleDistrictSelect}
                    options={districts.map(d => ({ value: d.pcode, label: d.name }))}
                    placeholder="Select a district..."
                  />
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end mt-6">
            <TacticalButton onClick={onClose} variant="secondary">
              Cancel
            </TacticalButton>
            <TacticalButton
              onClick={handleProceedToStep1}
              disabled={!selectedDistrict}
              className="ml-2"
            >
              Next
            </TacticalButton>
          </div>
        </div>
      )}

      {/* Step 1: Categorize Areas */}
      {step === 1 && (
        <div>
          <div className="mb-4 text-zinc-300">
            <span className="text-cyan-400">{selectedDistrictName}</span> - Drag upazilas
            into categories. All must be categorized to proceed.
          </div>

          {upazilasLoading ? (
            <div className="text-center py-8 text-zinc-400">Loading...</div>
          ) : (
            <DndContext
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-3 overflow-x-auto pb-4">
                <CategoryColumn
                  id="uncategorized"
                  title="Uncategorized"
                  count={categories.uncategorized.length}
                  color="gray"
                  totalPopulation={getPopulationForCategory(categories.uncategorized)}
                >
                  {categories.uncategorized.map((pcode) => {
                    const area = getAreaByPcode(pcode);
                    return area ? (
                      <DraggableAreaCard
                        key={pcode}
                        id={pcode}
                        name={area.name}
                        pcode={pcode}
                        population={area.population}
                      />
                    ) : null;
                  })}
                </CategoryColumn>

                <CategoryColumn
                  id="high_risk"
                  title="High Risk"
                  count={categories.high_risk.length}
                  color="red"
                  totalPopulation={getPopulationForCategory(categories.high_risk)}
                >
                  {categories.high_risk.map((pcode) => {
                    const area = getAreaByPcode(pcode);
                    return area ? (
                      <DraggableAreaCard
                        key={pcode}
                        id={pcode}
                        name={area.name}
                        pcode={pcode}
                        population={area.population}
                      />
                    ) : null;
                  })}
                </CategoryColumn>

                <CategoryColumn
                  id="low_risk"
                  title="Low Risk"
                  count={categories.low_risk.length}
                  color="green"
                  totalPopulation={getPopulationForCategory(categories.low_risk)}
                >
                  {categories.low_risk.map((pcode) => {
                    const area = getAreaByPcode(pcode);
                    return area ? (
                      <DraggableAreaCard
                        key={pcode}
                        id={pcode}
                        name={area.name}
                        pcode={pcode}
                        population={area.population}
                      />
                    ) : null;
                  })}
                </CategoryColumn>

                <CategoryColumn
                  id="hard_to_reach"
                  title="Hard to Reach"
                  count={categories.hard_to_reach.length}
                  color="yellow"
                  totalPopulation={getPopulationForCategory(categories.hard_to_reach)}
                >
                  {categories.hard_to_reach.map((pcode) => {
                    const area = getAreaByPcode(pcode);
                    return area ? (
                      <DraggableAreaCard
                        key={pcode}
                        id={pcode}
                        name={area.name}
                        pcode={pcode}
                        population={area.population}
                      />
                    ) : null;
                  })}
                </CategoryColumn>
              </div>

              <DragOverlay>
                {activeDragId ? (
                  (() => {
                    const area = getAreaByPcode(activeDragId);
                    return area ? (
                      <div className="p-2 bg-zinc-800 border-2 border-cyan-500 rounded shadow-xl cursor-grabbing">
                        <div className="text-sm font-medium text-zinc-100">{area.name}</div>
                        <div className="text-xs text-zinc-400">{area.pcode}</div>
                        {area.population !== undefined && area.population > 0 && (
                          <div className="text-xs text-cyan-400 mt-1">
                            Pop: {area.population.toLocaleString()}
                          </div>
                        )}
                      </div>
                    ) : null;
                  })()
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          <div className="flex justify-between mt-4">
            <TacticalButton onClick={() => setStep(0)} variant="secondary">
              Back
            </TacticalButton>
            <div>
              <TacticalButton onClick={onClose} variant="secondary">
                Cancel
              </TacticalButton>
              <TacticalButton
                onClick={() => setStep(2)}
                disabled={!canProceedStep1}
                className="ml-2"
              >
                Next
              </TacticalButton>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Sampling Parameters */}
      {step === 2 && (
        <div>
          <div className="space-y-4">
            <TacticalInput
              label="Round Name"
              value={roundName}
              onChange={setRoundName}
              placeholder="e.g., Round 1 - District Survey"
            />

            <div className="grid grid-cols-3 gap-4">
              <TacticalInput
                label="Upazilas to Select"
                type="number"
                value={upazilaCount}
                onChange={setUpazilaCount}
              />
              <TacticalInput
                label="Unions per Upazila"
                type="number"
                value={unionsPerUpazila}
                onChange={setUnionsPerUpazila}
              />
              <TacticalInput
                label="Pixels per Union"
                type="number"
                value={pixelsPerUnion}
                onChange={setPixelsPerUnion}
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-zinc-300">
                <input
                  type="checkbox"
                  checked={populationWeighted}
                  onChange={(e) => setPopulationWeighted(e.target.checked)}
                  className="rounded"
                />
                Weight selection by population
              </label>
            </div>

            <TacticalInput
              label="Minimum Population (optional)"
              type="number"
              value={minPopulation}
              onChange={setMinPopulation}
              placeholder="e.g., 10"
            />

            <div className="mt-4 p-3 bg-zinc-800 rounded border border-zinc-700">
              <div className="text-sm text-zinc-300">
                <strong>Summary:</strong> ~{estimatedPixels.toLocaleString()}{' '}
                pixels across {parseInt(upazilaCount || '0') * parseInt(unionsPerUpazila || '0')}{' '}
                unions in {upazilaCount} upazilas
              </div>
            </div>
          </div>

          <div className="flex justify-between mt-6">
            <TacticalButton onClick={() => setStep(1)} variant="secondary">
              Back
            </TacticalButton>
            <div>
              <TacticalButton onClick={onClose} variant="secondary">
                Cancel
              </TacticalButton>
              <TacticalButton
                onClick={handleSubmit}
                disabled={isSubmitting || !roundName.trim()}
                className="ml-2"
              >
                {isSubmitting ? 'Creating...' : 'Create Round'}
              </TacticalButton>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Workflow Progress */}
      {step === 3 && (
        <div>
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">
              Stratified Cluster Sampling
            </h3>
            <p className="text-sm text-zinc-400">
              Workflow ID: <span className="font-mono text-cyan-400">{workflowId}</span>
            </p>
          </div>

          {/* Status indicator */}
          <div className="mb-6 p-4 bg-zinc-800 rounded border border-zinc-700">
            <div className="flex items-center gap-3 mb-4">
              {workflowStatus === 'running' && (
                <>
                  <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-cyan-400 font-medium">Running...</span>
                </>
              )}
              {workflowStatus === 'completed' && (
                <>
                  <div className="w-4 h-4 bg-green-500 rounded-full" />
                  <span className="text-green-400 font-medium">Completed</span>
                </>
              )}
              {workflowStatus === 'failed' && (
                <>
                  <div className="w-4 h-4 bg-red-500 rounded-full" />
                  <span className="text-red-400 font-medium">Failed</span>
                </>
              )}
            </div>

            {/* Progress details */}
            {workflowProgress && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-zinc-300">
                  <span>Status:</span>
                  <span className="text-cyan-400 font-mono">{workflowProgress.status}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Upazilas Selected:</span>
                  <span className="text-cyan-400">{workflowProgress.selected_upazilas}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Unions Selected:</span>
                  <span className="text-cyan-400">{workflowProgress.selected_unions}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Sampling Workflows Started:</span>
                  <span className="text-cyan-400">{workflowProgress.child_workflows_started}</span>
                </div>
              </div>
            )}

            {/* Error message */}
            {workflowError && (
              <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                {workflowError}
              </div>
            )}

            {/* Result summary */}
            {workflowResult && (
              <div className="mt-4 space-y-2 text-sm">
                <div className="text-green-400 font-medium mb-2">Sampling Complete!</div>
                <div className="flex justify-between text-zinc-300">
                  <span>Round Number:</span>
                  <span className="text-green-400">{workflowResult.round_number}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Selected Upazilas:</span>
                  <span className="text-green-400">{workflowResult.selected_upazilas?.length || 0}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Selected Unions:</span>
                  <span className="text-green-400">{workflowResult.selected_unions?.length || 0}</span>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Campaign Areas Created:</span>
                  <span className="text-green-400">{workflowResult.campaign_area_ids?.length || 0}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end mt-6">
            <TacticalButton
              onClick={onClose}
              variant={workflowStatus === 'completed' || workflowStatus === 'failed' ? 'primary' : 'secondary'}
            >
              {workflowStatus === 'completed' || workflowStatus === 'failed' ? 'Close' : 'Run in Background'}
            </TacticalButton>
          </div>
        </div>
      )}
    </TacticalModal>
  );
};
