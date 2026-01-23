// ABOUTME: Three-step wizard for stratified cluster sampling round creation
// ABOUTME: Step 0: Select division/district, Step 1: Categorize areas, Step 2: Parameters
import React, { useState, useEffect } from 'react';
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core';
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
  campaignId: string;
  projectId: string;
  startingPcode?: string;
  startingName?: string;
  indicatorId: string;
  onRoundCreated: () => void;
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
}) => {
  void _projectId;
  const { getToken } = useAuth();
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 0 state - area selection
  const [divisions, setDivisions] = useState<AdminBoundary[]>([]);
  const [districts, setDistricts] = useState<AdminBoundary[]>([]);
  const [selectedDivision, setSelectedDivision] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedDistrictName, setSelectedDistrictName] = useState('');

  // Step 1 state - categorization
  const [children, setChildren] = useState<AdminBoundary[]>([]);
  const [categories, setCategories] = useState<Categories>({
    high_risk: [],
    low_risk: [],
    hard_to_reach: [],
    uncategorized: [],
  });

  // Step 2 state - parameters
  const [roundName, setRoundName] = useState('');
  const [upazilaCount, setUpazilaCount] = useState('3');
  const [unionsPerUpazila, setUnionsPerUpazila] = useState('2');
  const [pixelsPerUnion, setPixelsPerUnion] = useState('50');
  const [populationWeighted, setPopulationWeighted] = useState(false);
  const [minPopulation, setMinPopulation] = useState('');

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // If we have an initial pcode, skip to step 1
      if (initialPcode) {
        setSelectedDistrict(initialPcode);
        setSelectedDistrictName(initialName || '');
        setStep(1);
        fetchChildren(initialPcode);
      } else {
        setStep(0);
        fetchDivisions();
      }
    } else {
      // Reset all state when closed
      setStep(0);
      setDivisions([]);
      setDistricts([]);
      setSelectedDivision('');
      setSelectedDistrict('');
      setSelectedDistrictName('');
      setChildren([]);
      setCategories({ high_risk: [], low_risk: [], hard_to_reach: [], uncategorized: [] });
      setRoundName('');
    }
  }, [isOpen, initialPcode]);

  // Fetch divisions (adm1) on mount
  const fetchDivisions = async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      // Get country level (BD) children which are divisions
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

  // Fetch districts when division changes
  useEffect(() => {
    if (selectedDivision) {
      fetchDistricts(selectedDivision);
    } else {
      setDistricts([]);
      setSelectedDistrict('');
    }
  }, [selectedDivision]);

  const fetchDistricts = async (divisionPcode: string) => {
    setIsLoading(true);
    try {
      const token = await getToken();
      const response = await axios.get(
        `${API_URL}/api/admin-boundaries/${divisionPcode}/children`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setDistricts(response.data.children || []);
    } catch (error) {
      console.error('Error fetching districts:', error);
      tacticalToast.error('Failed to load districts');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchChildren = async (pcode: string) => {
    setIsLoading(true);
    try {
      const token = await getToken();
      const response = await axios.get(
        `${API_URL}/api/admin-boundaries/${pcode}/children`,
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

  const handleDistrictSelect = (pcode: string) => {
    setSelectedDistrict(pcode);
    const district = districts.find(d => d.pcode === pcode);
    setSelectedDistrictName(district?.name || '');
  };

  const handleProceedToStep1 = () => {
    if (selectedDistrict) {
      fetchChildren(selectedDistrict);
      setStep(1);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
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

  const getAreaByPcode = (pcode: string) =>
    children.find((c) => c.pcode === pcode);

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
      await axios.post(
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
      title="Stratified Round"
      size="xl"
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
              <TacticalSelect
                value={selectedDivision}
                onChange={setSelectedDivision}
                options={divisions.map(d => ({ value: d.pcode, label: d.name }))}
                placeholder="Select a division..."
              />
            </div>

            {selectedDivision && (
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">
                  District
                </label>
                {isLoading ? (
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
    </TacticalModal>
  );
};
