import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { AuthProvider } from '@gitroom/saas-mobile/context/auth.context';
import { App } from '@gitroom/saas-mobile/app';
import '@gitroom/saas-mobile/styles/global.scss';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SWRConfig value={{ revalidateOnFocus: false }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </SWRConfig>
  </StrictMode>
);
