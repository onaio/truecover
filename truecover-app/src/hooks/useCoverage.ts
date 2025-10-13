import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface PredictCoverageParams {
  area_id: string;
  indicator_id: string;
  round_id: string;
}

interface PredictCoverageResult {
  success: boolean;
  version: number;
  total_locations: number;
  inserted: number;
  errors: string[];
}

export const useCoverage = () => {
  const { getToken } = useAuth();

  const predictCoverage = async (params: PredictCoverageParams): Promise<PredictCoverageResult> => {
    const token = await getToken();

    const response = await axios.post(
      `${API_URL}/api/coverage/predict`,
      params,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  };

  return { predictCoverage };
};
