import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { loadRuntimeConfig } from './api/client';
import type { RuntimeConfig } from './domain/types';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 2_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

function Bootstrap() {
  const [config, setConfig] = useState<RuntimeConfig>();
  const [error, setError] = useState<Error>();
  useEffect(() => { loadRuntimeConfig().then(setConfig).catch(setError); }, []);
  if (error) return <div className="page-state"><strong>控制台启动失败</strong><span>{error.message}</span></div>;
  if (!config) return <div className="page-state"><span>正在加载运行配置...</span></div>;
  return <BrowserRouter><App config={config} /></BrowserRouter>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={queryClient}><Bootstrap /></QueryClientProvider></StrictMode>,
);
