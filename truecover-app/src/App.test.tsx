import { test, expect, vi } from 'vitest';
import React from 'react';
import { renderWithProviders } from './test-utils';

// Mock Clerk auth before importing App
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: false, getToken: vi.fn() }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: (_props: { children: React.ReactNode }) => null,
  SignedOut: ({ children }: { children: React.ReactNode }) => children,
  SignInButton: () => null,
  UserButton: () => null,
}));

test('renders app without crashing', async () => {
  const { default: App } = await import('./App');
  renderWithProviders(<App />);
  expect(document.body).toBeTruthy();
});
