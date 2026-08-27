import { FC } from 'react';
import { NavLink } from '@gitroom/saas-mobile/components/nav.link';

const tabs = [
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/compose', label: 'Compose', icon: '✏️' },
  { to: '/inbox', label: 'Inbox', icon: '💬' },
  { to: '/media', label: 'Media', icon: '🖼️' },
  { to: '/analytics', label: 'Stats', icon: '📊' },
];

export const BottomNav: FC = () => {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-third bg-secondary pb-safe-bottom">
      <ul className="grid grid-cols-5 max-w-lg mx-auto">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink to={tab.to} className="flex flex-col items-center py-2 px-1">
              {({ active }) => (
                <>
                  <span className="text-lg leading-none" aria-hidden>
                    {tab.icon}
                  </span>
                  <span
                    className={`text-[10px] mt-1 truncate max-w-full ${
                      active ? 'text-sixth font-medium' : 'text-fifth'
                    }`}
                  >
                    {tab.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
};
