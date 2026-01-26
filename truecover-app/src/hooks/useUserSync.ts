import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import axios from 'axios';
import { env } from '../config/env';

const API_URL = env.VITE_API_URL;

/**
 * Hook to automatically sync Clerk user with backend database on sign-in
 */
export const useUserSync = () => {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    const syncUser = async () => {
      if (isSignedIn) {
        try {
          const token = await getToken();

          // Call /api/user/me to trigger user sync in backend
          await axios.get(`${API_URL}/api/user/me`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
        } catch (error: any) {
          console.error('Failed to sync user:', error);
          console.error('Error details:', error.response?.data);
        }
      }
    };

    syncUser();
  }, [isSignedIn, getToken]);
};
