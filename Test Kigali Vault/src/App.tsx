import { useEffect, useState } from 'react';
import { MemberPortal } from './components/MemberPortal.tsx';
import { PublicMarketplace } from './components/PublicMarketplace.tsx';
import { StaffPortal } from './components/StaffPortal.tsx';
import { SuperAdminPortal } from './components/SuperAdminPortal.tsx';
import { apiFetch, getStoredToken, setStoredToken } from './lib/api.ts';
import type { AuthUser } from './types.ts';

type ViewMode = 'marketplace' | 'portal';

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  // Always open on the Public Marketplace homepage
  const [viewMode, setViewMode] = useState<ViewMode>('marketplace');

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    apiFetch<{ user: AuthUser }>('/api/auth/me')
      .then((res) => {
        setAuthUser(res.user);
      })
      .catch(() => {
        setStoredToken(null);
        setAuthUser(null);
      });
  }, []);

  const handleAuthenticated = (user: AuthUser) => {
    setAuthUser(user);
    setViewMode('portal');
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore logout network errors
    }
    setStoredToken(null);
    setAuthUser(null);
    setViewMode('marketplace');
  };

  if (viewMode === 'portal' && authUser) {
    if (authUser.role === 'super_admin') {
      return (
        <SuperAdminPortal
          authUser={authUser}
          onGoToMarketplace={() => setViewMode('marketplace')}
          onLogout={() => void handleLogout()}
        />
      );
    }
    if (authUser.role === 'staff') {
      return (
        <StaffPortal
          authUser={authUser}
          onGoToMarketplace={() => setViewMode('marketplace')}
          onLogout={() => void handleLogout()}
        />
      );
    }
    return (
      <MemberPortal
        authUser={authUser}
        onGoToMarketplace={() => setViewMode('marketplace')}
        onLogout={() => void handleLogout()}
      />
    );
  }

  return (
    <PublicMarketplace
      authUser={authUser}
      onAuthenticated={handleAuthenticated}
      onOpenPortal={() => {
        if (authUser) setViewMode('portal');
      }}
    />
  );
}
