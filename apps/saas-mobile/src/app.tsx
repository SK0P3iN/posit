import { FC, useEffect, useState } from 'react';
import { AppShell } from '@gitroom/saas-mobile/components/app.shell';
import { useAuth } from '@gitroom/saas-mobile/context/auth.context';
import { LoginPage } from '@gitroom/saas-mobile/pages/login.page';
import { PlaceholderPage } from '@gitroom/saas-mobile/pages/placeholder.page';

const routeFromPath = (path: string) => {
  if (path.startsWith('/compose')) return 'compose';
  if (path.startsWith('/inbox')) return 'inbox';
  if (path.startsWith('/media')) return 'media';
  if (path.startsWith('/analytics')) return 'analytics';
  return 'calendar';
};

export const App: FC = () => {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState(() =>
    routeFromPath(typeof window !== 'undefined' ? window.location.pathname : '/')
  );

  useEffect(() => {
    const onPop = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-fifth">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const content = {
    calendar: (
      <PlaceholderPage
        title="Calendar"
        description="Agenda view of scheduled posts — coming in U8."
      />
    ),
    compose: (
      <PlaceholderPage
        title="Compose"
        description="Stepped post wizard — coming in U7."
      />
    ),
    inbox: (
      <PlaceholderPage
        title="Inbox"
        description="Social inbox threads — coming in U12."
      />
    ),
    media: (
      <PlaceholderPage
        title="Media"
        description="Media library with folders — coming in U10."
      />
    ),
    analytics: (
      <PlaceholderPage
        title="Analytics"
        description="Channel insights — coming in U11."
      />
    ),
  }[route];

  return <AppShell>{content}</AppShell>;
};
