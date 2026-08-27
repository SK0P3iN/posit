import {
  createContext,
  FC,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { mutate } from 'swr';
import { bffFetch } from '@gitroom/saas-mobile/lib/bff.fetch';
import { SaasUser, useSession } from '@gitroom/saas-mobile/hooks/use.session';

interface AuthContextValue {
  user: SaasUser | undefined;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [bootstrapped, setBootstrapped] = useState(false);
  const { data, isLoading, error } = useSession(bootstrapped);

  useEffect(() => {
    setBootstrapped(true);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await bffFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await mutate('saas-session');
  }, []);

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      await bffFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      });
      await mutate('saas-session');
    },
    []
  );

  const logout = useCallback(async () => {
    await bffFetch('/auth/logout', { method: 'POST' });
    await mutate('saas-session', undefined, { revalidate: false });
  }, []);

  const value = useMemo(
    () => ({
      user: error ? undefined : data,
      loading: !bootstrapped || isLoading,
      login,
      register,
      logout,
    }),
    [bootstrapped, data, error, isLoading, login, logout, register]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
};
