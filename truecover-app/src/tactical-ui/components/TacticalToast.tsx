// ABOUTME: Tactical-themed toast notification component wrapper
// ABOUTME: Uses sonner library with custom tactical styling

import React from 'react';
import { Toaster, toast as sonnerToast } from 'sonner';

/**
 * TacticalToaster - The toast container component
 * Place this once in your app root (e.g., App.tsx or main layout)
 */
export const TacticalToaster: React.FC = () => {
  return (
    <Toaster
      position="top-right"
      expand={false}
      richColors={false}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'tactical-toast',
          title: 'tactical-toast-title',
          description: 'tactical-toast-description',
          success: 'tactical-toast-success',
          error: 'tactical-toast-error',
          warning: 'tactical-toast-warning',
          info: 'tactical-toast-info',
        },
      }}
    />
  );
};

/**
 * Tactical toast API
 * Use these functions to show toasts throughout your app
 */
export const tacticalToast = {
  success: (message: string, description?: string) => {
    return sonnerToast.success(message, {
      description,
      duration: 5000,
    });
  },

  error: (message: string, description?: string) => {
    return sonnerToast.error(message, {
      description,
      duration: 7000,
    });
  },

  warning: (message: string, description?: string) => {
    return sonnerToast.warning(message, {
      description,
      duration: 6000,
    });
  },

  info: (message: string, description?: string) => {
    return sonnerToast.info(message, {
      description,
      duration: 5000,
    });
  },

  message: (message: string, description?: string) => {
    return sonnerToast(message, {
      description,
      duration: 4000,
    });
  },
};
