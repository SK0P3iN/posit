import { FC, ReactNode } from 'react';
import { BottomNav } from '@gitroom/saas-mobile/components/bottom.nav';
import { useAuth } from '@gitroom/saas-mobile/context/auth.context';

export const AppShell: FC<{ children: ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-dvh flex flex-col pt-safe-top">
      <header className="sticky top-0 z-10 border-b border-third bg-secondary/95 backdrop-blur px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-fifth">Signed in as</p>
          <p className="text-sm font-medium truncate max-w-[220px]">
            {user?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="text-xs text-fifth border border-third rounded-lg px-3 py-1.5"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      <BottomNav />
    </div>
  );
};
