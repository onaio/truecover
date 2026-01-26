import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import { env } from '../config/env';

const API_URL = env.VITE_API_URL;

interface PredictCoverageParams {
  campaign_id: string;
  indicator_id: string;
}

interface PredictCoverageResult {
  workflow_id: string;
  status: string;
  message: string;
}

interface PredictCoverageStatusResult {
  workflow_id: string;
  status: string;
  result?: {
    total_locations?: number;
    total_pixels?: number;
    updated: number;
  };
  error?: string;
}

export interface CoverageRecord {
  id: string;
  location_id: string;
  campaign_id: string;
  indicator_id: string;
  round_id: string | null;
  version: number;
  n_trials: number;
  n_covered: number;
  exceedance_probability: number | null;
  exceedance_uncertainty: number | null;
  prevalence_bci_width: number | null;
  prevalence_prediction: number | null;
  created_at: string | null;
  updated_at: string | null;
  last_predicted_at: string | null;
  latitude: number | null;
  longitude: number | null;
  external_id: string | null;
  indicator_name: string;
  rounds: number[];
  quadkey: string | null;
}

export interface CoveragePixelRecord {
  id: string;
  quadkey: string;
  campaign_id: string;
  indicator_id: string;
  version: number;
  n_trials: number;
  n_covered: number;
  exceedance_probability: number | null;
  exceedance_uncertainty: number | null;
  prevalence_bci_width: number | null;
  prevalence_prediction: number | null;
  created_at: string | null;
  updated_at: string | null;
  last_predicted_at: string | null;
  indicator_name: string;
  rounds: number[];
  location_count: number;
}

interface ListCoverageParams {
  campaign_id: string;
  indicator_id?: string;
  round_id?: string;
}

export const useCoverage = () => {
  const { getToken } = useAuth();

  const predictCoverage = async (params: PredictCoverageParams): Promise<PredictCoverageResult> => {
    const token = await getToken();

    const response = await axios.post(
      `${API_URL}/api/coverage/predict/workflow`,
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

  const getPredictionStatus = async (workflowId: string): Promise<PredictCoverageStatusResult> => {
    const token = await getToken();

    const response = await axios.get(
      `${API_URL}/api/coverage/predict/workflow/${workflowId}/status`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.data;
  };

  const listCoverage = async (params: ListCoverageParams): Promise<CoverageRecord[]> => {
    const token = await getToken();

    // Build query string
    const queryParams = new URLSearchParams();
    if (params.indicator_id) {
      queryParams.append('indicator_id', params.indicator_id);
    }
    if (params.round_id) {
      queryParams.append('round_id', params.round_id);
    }

    const queryString = queryParams.toString();
    const url = `${API_URL}/api/campaigns/${params.campaign_id}/coverage${queryString ? `?${queryString}` : ''}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data.coverage || [];
  };

  const getCoverageGeoJSON = async (params: ListCoverageParams): Promise<any> => {
    const token = await getToken();

    // Build query string
    const queryParams = new URLSearchParams();
    if (params.indicator_id) {
      queryParams.append('indicator_id', params.indicator_id);
    }
    if (params.round_id) {
      queryParams.append('round_id', params.round_id);
    }

    const queryString = queryParams.toString();
    const url = `${API_URL}/api/campaigns/${params.campaign_id}/coverage/geojson${queryString ? `?${queryString}` : ''}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data;
  };

  const listCoveragePixel = async (params: ListCoverageParams): Promise<CoveragePixelRecord[]> => {
    const token = await getToken();

    // Build query string
    const queryParams = new URLSearchParams();
    if (params.indicator_id) {
      queryParams.append('indicator_id', params.indicator_id);
    }
    if (params.round_id) {
      queryParams.append('round_id', params.round_id);
    }

    const queryString = queryParams.toString();
    const url = `${API_URL}/api/campaigns/${params.campaign_id}/coverage_pixel${queryString ? `?${queryString}` : ''}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data.coverage_pixel || [];
  };

  return { predictCoverage, getPredictionStatus, listCoverage, getCoverageGeoJSON, listCoveragePixel };
};
