import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/Auth.jsx';
import { ThemeProvider } from './context/Theme.jsx';
import { FeedbackProvider } from './context/Toast.jsx';
import App from './App.jsx';
import './styles/app.css';
import './styles/site.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error?.status >= 400 && error?.status < 500) && count < 2
    }
  }
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <FeedbackProvider>
          <AuthProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </FeedbackProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
