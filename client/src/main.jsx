import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// تلات أصوات (docs/DESIGN_SYSTEM.md قسم 4): اليافطة بالرقعة، والماركر، والكلام
import '@fontsource/aref-ruqaa-ink/700.css';
import '@fontsource-variable/playpen-sans-arabic/index.css';
import '@fontsource-variable/readex-pro/index.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/brand.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/screens.css';

import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ConfirmProvider } from './components/ui/Overlays.jsx';
import { ApiRequestError } from './lib/api.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // ما نعيدش على أخطاء منطقية (401/403/404/422)؛ الشبكة والـ 5xx بس
      retry: (count, error) => count < 2 && (!(error instanceof ApiRequestError) || error.offline || error.status >= 500),
    },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
