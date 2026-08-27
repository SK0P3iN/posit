import useSWR from 'swr';
import { bffFetch } from '@gitroom/saas-mobile/lib/bff.fetch';

export interface SaasUser {
  id: string;
  email: string;
  name: string;
  postizOrgId: string;
}

export const useSession = (enabled: boolean) => {
  return useSWR<SaasUser>(
    enabled ? 'saas-session' : null,
    () => bffFetch('/auth/me') as Promise<SaasUser>
  );
};
