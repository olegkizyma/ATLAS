import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from './components/ConfigContext';
import {
  ClientInitializationProvider,
  RequireClientInitialization,
} from './contexts/ClientInitializationContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { patchConsoleLogging } from './utils';
import SuspenseLoader from './suspense-loader';

// Import styles
import './styles/main.css';

// Import browser mocks for development
import './browser-mock';

patchConsoleLogging();

const App = lazy(() => import('./App'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ClientInitializationProvider>
    <React.StrictMode>
      <Suspense fallback={SuspenseLoader()}>
        <RequireClientInitialization>
          <ConfigProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </ConfigProvider>
        </RequireClientInitialization>
      </Suspense>
    </React.StrictMode>
  </ClientInitializationProvider>
);
