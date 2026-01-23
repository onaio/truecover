// ABOUTME: Two-step wizard for stratified cluster sampling round creation
// ABOUTME: Step 1: Drag-drop area categorization, Step 2: Sampling parameters
import React, { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import {
  TacticalModal,
  TacticalButton,
  TacticalInput,
  tacticalToast,
} from '../tactical-ui';
import { DraggableAreaCard } from './DraggableAreaCard';
import { CategoryColumn } from './CategoryColumn';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

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
  areaId: string;
  projectId: string;
  indicatorId: string;
  onRoundCreated: () => void;
}

export const StratifiedClusterSamplingWizard: React.FC<
  StratifiedClusterSamplingWizardProps
> = ({
  isOpen,
  onClose,
  areaId,
  projectId: _projectId,
  indicatorId,
  onRoundCreated,
}) => {
  // projectId may be used in future enhancements
  void _projectId;
  const { getToken } = useAuth();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1 state - Division selection
  const [divisions, setDivisions] = useState<AdminBoundary[]>([]);
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [selectedDivisionName, setSelectedDivisionName] = useState<string>('');

  // Step 2 state - Categorization
  const [children, setChildren] = useState<AdminBoundary[]>([]);
  const [categories, setCategories] = useState<Categories>({
    high_risk: [],
    low_risk: [],
    hard_to_reach: [],
    uncategorized: [],
  });

  // Step 3 state - Parameters
  const [roundName, setRoundName] = useState('');
  const [upazilaCount, setUpazilaCount] = useState('3');
  const [unionsPerUpazila, setUnionsPerUpazila] = useState('2');
  const [pixelsPerUnion, setPixelsPerUnion] = useState('50');
  const [populationWeighted, setPopulationWeighted] = useState(false);
  const [minPopulation, setMinPopulation] = useState('');

  // Fetch divisions on mount
  useEffect(() => {
    if (isOpen) {
      fetchDivisions();
    }
  }, [isOpen]);

  // Fetch children when division selected
  useEffect(() => {
    if (selectedDivision) {
      fetchChildren();
    }
  }, [selectedDivision]);

  const fetchDivisions = async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      // Fetch level-1 divisions (children of country BD)
      const response = await axios.get(
        `${API_URL}/api/admin-boundaries/BD/children`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setDivisions(response.data.children || []);
    } catch (error) {
      console.error('Error fetching divisions:', error);
      tacticalToast.error('Failed to load divisions');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchChildren = async () => {
    if (!selectedDivision) return;
    setIsLoading(true);
    try {
      const token = await getToken();
      const response = await axios.get(
        `${API_URL}/api/admin-boundaries/${selectedDivision}/children`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const childData = response.data.children || [];
      setChildren(childData);
      setCategories({
        high_risk: [],
        low_risk: [],
        hard_to_reach: [],
        uncategorized: childData.map((c: AdminBoundary) => c.pcode),
      });
    } catch (error) {
      console.error('Error fetching children:', error);
      tacticalToast.error('Failed to load areas');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDivisionChange = (pcode: string) => {
    setSelectedDivision(pcode);
    const div = divisions.find(d => d.pcode === pcode);
    setSelectedDivisionName(div?.name || '');
    // Reset categorization when division changes
    setCategories({
      high_risk: [],
      low_risk: [],
      hard_to_reach: [],
      uncategorized: [],
    });
    setChildren([]);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const draggedPcode = active.id as string;
    const targetCategory = over.id as keyof Categories;

    // Remove from current category
    const newCategories = { ...categories };
    for (const cat of Object.keys(newCategories) as (keyof Categories)[]) {
      newCategories[cat] = newCategories[cat].filter((p) => p !== draggedPcode);
    }

    // Add to new category
    newCategories[targetCategory].push(draggedPcode);
    setCategories(newCategories);
  };

  const getAreaByPcode = (pcode: string) =>
    children.find((c) => c.pcode === pcode);

  const canProceedStep1 = categories.uncategorized.length === 0;

  const estimatedPixels =
    parseInt(upazilaCount) *
    parseInt(unionsPerUpazila) *
    parseInt(pixelsPerUnion);

  const estimatedPopulation = () => {
    const categorizedPcodes = [
      ...categories.high_risk,
      ...categories.low_risk,
      ...categories.hard_to_reach,
    ];
    const totalPop = children
      .filter((c) => categorizedPcodes.includes(c.pcode))
      .reduce((sum, c) => sum + (c.population || 0), 0);

    if (totalPop === 0) return null;

    const avgPopPerPixel = totalPop / children.length / 100; // rough estimate
    return Math.round(estimatedPixels * avgPopPerPixel);
  };

  const handleSubmit = async () => {
    if (!roundName.trim()) {
      tacticalToast.error('Round name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await getToken();
      await axios.post(
        `${API_URL}/api/areas/${areaId}/rounds/stratified-cluster`,
        {
          name: roundName.trim(),
          starting_pcode: selectedDivision,
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

      tacticalToast.success('Stratified cluster sampling started');
      onRoundCreated();
      onClose();
    } catch (error: any) {
      console.error('Error creating round:', error);
      tacticalToast.error(
        error.response?.data?.error || 'Failed to create round'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={onClose}
      title="Stratified Cluster Sampling"
      size="xl"
    >
      {step === 1 && (
        <div>
          <div className="mb-4 text-zinc-300">
            Select a division to start stratified cluster sampling.
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-zinc-400">Loading divisions...</div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Division
                </label>
                <select
                  value={selectedDivision}
                  onChange={(e) => handleDivisionChange(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-zinc-100 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="">Select a division...</option>
                  {divisions.map((div) => (
                    <option key={div.pcode} value={div.pcode}>
                      {div.name} {div.population ? `(Pop: ${div.population.toLocaleString()})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex justify-end mt-6">
            <TacticalButton onClick={onClose} variant="secondary">
              Cancel
            </TacticalButton>
            <TacticalButton
              onClick={() => setStep(2)}
              disabled={!selectedDivision}
              className="ml-2"
            >
              Next
            </TacticalButton>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="mb-4 text-zinc-300">
            <span className="text-cyan-400">{selectedDivisionName}</span> - Drag districts
            into categories. All districts must be categorized to proceed.
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-zinc-400">Loading...</div>
          ) : (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-3 overflow-x-auto pb-4">
                <CategoryColumn
                  id="uncategorized"
                  title="Uncategorized"
                  count={categories.uncategorized.length}
                  color="gray"
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
            </DndContext>
          )}

          <div className="flex justify-between mt-4">
            <TacticalButton onClick={() => setStep(1)} variant="secondary">
              Back
            </TacticalButton>
            <div>
              <TacticalButton onClick={onClose} variant="secondary">
                Cancel
              </TacticalButton>
              <TacticalButton
                onClick={() => setStep(3)}
                disabled={!canProceedStep1}
                className="ml-2"
              >
                Next
              </TacticalButton>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
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
                pixels across {parseInt(upazilaCount) * parseInt(unionsPerUpazila)}{' '}
                unions in {upazilaCount} upazilas
                {estimatedPopulation() && (
                  <span className="text-cyan-400 ml-2">
                    (Est. pop: {estimatedPopulation()?.toLocaleString()})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-between mt-6">
            <TacticalButton onClick={() => setStep(2)} variant="secondary">
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
    </TacticalModal>
  );
};
