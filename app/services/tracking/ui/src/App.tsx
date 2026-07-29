import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { User } from 'oidc-client-ts';
import { LogOut } from 'lucide-react';
import { currentUsername, userManager } from './auth';
import { getMe } from './api';
import { Button, Skeleton } from './components/primitives';
import LinksPage from './pages/LinksPage';
import LinkDetailPage from './pages/LinkDetailPage';

const queryClient = new QueryClient();

// Login gate: OAuth code + PKCE against Keycloak. /callback handles the
// redirect back; every other path silently kicks off signinRedirect when
// there's no valid session.
const AuthGate = ({ children }: { children: (user: User) => JSX.Element }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (location.pathname === '/callback') {
          const signedIn = await userManager.signinRedirectCallback();
          if (cancelled) return;
          setUser(signedIn);
          navigate('/', { replace: true });
          return;
        }
        const existing = await userManager.getUser();
        if (cancelled) return;
        if (existing && !existing.expired) {
          setUser(existing);
        } else {
          await userManager.signinRedirect({ state: location.pathname });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Sign-in failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-lg border border-border p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <div className="mt-4">
          <Button onClick={() => userManager.signinRedirect()}>Try again</Button>
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="mx-auto mt-24 max-w-md space-y-2 p-8">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-full" />
        <p className="pt-2 text-center text-sm text-muted-foreground">Signing in…</p>
      </div>
    );
  }
  return children(user);
};

const Shell = ({ user }: { user: User }) => {
  const access = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    staleTime: Infinity,
    retry: false,
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <span className="text-sm font-semibold">STRATO Tracking</span>
          <span className="flex items-center gap-3 text-sm text-muted-foreground">
            {currentUsername(user)}
            <button
              onClick={() => userManager.signoutRedirect()}
              aria-label="Sign out"
              title="Sign out"
              className="hover:text-foreground"
            >
              <LogOut size={16} />
            </button>
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {access.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !access.data?.authorized ? (
          <div className="mx-auto max-w-md rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to tracking links. Contact an administrator to be added.
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<LinksPage />} />
            <Route path="/links/:id" element={<LinkDetailPage />} />
            <Route path="*" element={<LinksPage />} />
          </Routes>
        )}
      </main>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter basename="/dashboard">
      <AuthGate>{(user) => <Shell user={user} />}</AuthGate>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
