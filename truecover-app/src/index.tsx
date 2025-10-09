import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { ClerkProvider } from '@clerk/clerk-react';

const clerkPubKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

if (!clerkPubKey) {
  throw new Error('Missing Clerk Publishable Key');
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={clerkPubKey}
      appearance={{
        baseTheme: undefined,
        variables: {
          colorPrimary: '#ffffff',
          colorBackground: '#000000',
          colorInputBackground: '#000000',
          colorInputText: '#ffffff',
          colorText: '#ffffff',
          colorTextSecondary: '#999999',
          colorDanger: '#ff0000',
          borderRadius: '0px',
        },
        elements: {
          card: 'bg-black border-2 border-white rounded-none shadow-none',
          headerTitle: 'text-white font-mono uppercase tracking-wider text-xl',
          headerSubtitle: 'text-gray-400 font-mono',
          socialButtonsBlockButton: 'border-2 border-white rounded-none bg-black text-white font-mono hover:bg-white hover:text-black transition-colors',
          formButtonPrimary: 'bg-black border-2 border-white rounded-none hover:bg-white hover:text-black font-mono uppercase tracking-wider transition-colors',
          formFieldInput: 'bg-black border-2 border-white rounded-none text-white font-mono focus:border-white focus:ring-0',
          footerActionLink: 'text-white hover:text-gray-400 font-mono underline',
          identityPreviewText: 'text-white font-mono',
          formFieldLabel: 'text-white font-mono uppercase text-xs tracking-wider',
          dividerLine: 'bg-white',
          dividerText: 'text-white font-mono',
          modalBackdrop: 'bg-black bg-opacity-90',
          modalContent: 'rounded-none',
        }
      }}
    >
      <App />
    </ClerkProvider>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
