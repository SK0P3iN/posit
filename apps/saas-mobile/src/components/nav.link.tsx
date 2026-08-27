import { FC, ReactNode } from 'react';

interface NavLinkProps {
  to: string;
  className?: string;
  children: (state: { active: boolean }) => ReactNode;
}

export const NavLink: FC<NavLinkProps> = ({ to, className, children }) => {
  const active =
    typeof window !== 'undefined' &&
    (window.location.pathname === to ||
      (to !== '/calendar' && window.location.pathname.startsWith(to)));

  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        if (window.location.pathname !== to) {
          window.history.pushState({}, '', to);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      }}
    >
      {children({ active })}
    </a>
  );
};
