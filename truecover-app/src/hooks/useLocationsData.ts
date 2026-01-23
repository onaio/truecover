import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { locationsApi } from '../services/api';

export const useLocationsData = () => {
  const { getToken, isSignedIn } = useAuth();
  const [isLocationUploadModalOpen, setIsLocationUploadModalOpen] = useState(false);
  const [isLocationEditModalOpen, setIsLocationEditModalOpen] = useState(false);
  const [selectedLocationForEdit, setSelectedLocationForEdit] = useState<any | null>(null);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [selectedRoundFilter, setSelectedRoundFilter] = useState<number | null>(null);
  const [mapHighlightRounds, setMapHighlightRounds] = useState<number[]>([]);

  // Visit Data state
  const [isAddVisitModalOpen, setIsAddVisitModalOpen] = useState(false);
  const [isGenerateMockDataModalOpen, setIsGenerateMockDataModalOpen] = useState(false);
  const [selectedRoundForVisit, setSelectedRoundForVisit] = useState<string>('');

  const loadLocations = async (campaignId: string, setLocations: (locations: any) => void) => {
    if (!campaignId || !isSignedIn) return;

    setIsLoadingLocations(true);
    try {
      const token = await getToken();
      if (token) {
        const locationsData = await locationsApi.list(campaignId, token);
        setLocations(locationsData);
      }
    } catch (error) {
      console.error('Failed to load locations:', error);
      setLocations(null);
    } finally {
      setIsLoadingLocations(false);
    }
  };

  const handleLocationsUploaded = async (campaignId: string, setLocations: (locations: any) => void) => {
    if (!campaignId || !isSignedIn) return;

    try {
      const token = await getToken();
      if (token) {
        const locationsData = await locationsApi.list(campaignId, token);
        setLocations(locationsData);
      }
    } catch (error) {
      console.error('Failed to refresh locations:', error);
    }
  };

  const handleEditLocation = (location: any) => {
    setSelectedLocationForEdit(location);
    setIsLocationEditModalOpen(true);
  };

  const handleLocationUpdated = async (campaignId: string, setLocations: (locations: any) => void) => {
    setIsLocationEditModalOpen(false);
    setSelectedLocationForEdit(null);
    await handleLocationsUploaded(campaignId, setLocations);
  };

  const handleLocationDeleted = async (campaignId: string, setLocations: (locations: any) => void) => {
    await handleLocationsUploaded(campaignId, setLocations);
  };

  return {
    isLocationUploadModalOpen,
    setIsLocationUploadModalOpen,
    isLocationEditModalOpen,
    setIsLocationEditModalOpen,
    selectedLocationForEdit,
    setSelectedLocationForEdit,
    isLoadingLocations,
    selectedRoundFilter,
    setSelectedRoundFilter,
    mapHighlightRounds,
    setMapHighlightRounds,
    isAddVisitModalOpen,
    setIsAddVisitModalOpen,
    isGenerateMockDataModalOpen,
    setIsGenerateMockDataModalOpen,
    selectedRoundForVisit,
    setSelectedRoundForVisit,
    loadLocations,
    handleLocationsUploaded,
    handleEditLocation,
    handleLocationUpdated,
    handleLocationDeleted,
  };
};
