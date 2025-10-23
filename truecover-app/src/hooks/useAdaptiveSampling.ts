import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';
import { FileData, SamplingRequest } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

export const useAdaptiveSampling = () => {
  const { getToken } = useAuth();
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileLoaded = (data: FileData) => {
    // Reset adaptively_selected to 0 for all features
    // This ensures we start fresh and select new points
    if (data.data && data.data.features) {
      const cleanedData = {
        ...data.data,
        features: data.data.features.map((feature: any) => ({
          ...feature,
          properties: {
            ...feature.properties,
            adaptively_selected: 0
          }
        }))
      };
      setFileData({ ...data, data: cleanedData });
    } else {
      setFileData(data);
    }
    setResult(null);
    setError(null);
  };

  const handleSubmit = async (batchSize: number, fieldName: string) => {
    if (!fileData) return;

    setIsLoading(true);
    setError(null);

    const request: SamplingRequest = {
      point_data: fileData.data,
      uncertainty_fieldname: fieldName,
      batch_size: batchSize
    };

    try {
      // Get Clerk auth token
      const token = await getToken();

      const response = await axios.post(`${API_URL}/api/sampling`, request, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      // Extract the actual result from the response
      let resultData = response.data;

      // Handle string responses with log messages
      if (typeof response.data === 'string') {
        const jsonMatch = response.data.match(/\{.*\}$/s);
        if (jsonMatch) {
          try {
            resultData = JSON.parse(jsonMatch[0]);
          } catch {
            resultData = response.data;
          }
        }
      }

      // If response has function_status wrapper, extract the result
      if (resultData?.function_status === 'success' && resultData?.result) {
        resultData = resultData.result;
      }

      setResult(JSON.stringify(resultData, null, 2));
    } catch (err: any) {
      console.error('Error calling adaptive sampling service:', err);

      // Extract error from response
      let errorMsg = 'Failed to connect to the adaptive sampling service';

      if (err.response?.data) {
        const data = err.response.data;
        if (typeof data === 'string') {
          try {
            const parsed = JSON.parse(data.match(/\{.*\}$/s)?.[0] || data);
            errorMsg = parsed.result || parsed.message || data;
          } catch {
            errorMsg = data;
          }
        } else if (data.result) {
          errorMsg = data.result;
        } else if (data.message) {
          errorMsg = data.message;
        }
      } else if (err.message) {
        errorMsg = err.message;
      }

      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;

    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(result);
    const exportFileDefaultName = 'adaptive_sampling_result.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    alert('Result copied to clipboard!');
  };

  return {
    fileData,
    isLoading,
    result,
    error,
    handleFileLoaded,
    handleSubmit,
    handleDownload,
    handleCopy,
  };
};
