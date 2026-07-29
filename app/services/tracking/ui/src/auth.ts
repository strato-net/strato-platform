import { User, UserManager } from 'oidc-client-ts';

// OAuth code + PKCE against the existing Keycloak realm. The tracking API
// verifies the resulting JWT (signature via JWKS) and applies the
// sales/marketing allowlist server-side. Requires a PUBLIC Keycloak client
// (default id: tracking-dashboard) with this origin's /dashboard/callback as a
// valid redirect URI.
const env = (window as unknown as { ENV?: Record<string, string> }).ENV ?? {};

export const explorerUrl = (env.EXPLORER_URL ?? 'https://stratoscan.strato.nexus').replace(
  /\/$/,
  ''
);

export const userManager = new UserManager({
  authority: env.OIDC_AUTHORITY ?? 'https://keycloak.blockapps.net/auth/realms/mercata',
  client_id: env.OIDC_CLIENT_ID ?? 'tracking-dashboard',
  redirect_uri: `${window.location.origin}/dashboard/callback`,
  post_logout_redirect_uri: `${window.location.origin}/dashboard`,
  response_type: 'code',
  scope: 'openid email profile',
  automaticSilentRenew: true,
});

export const getAccessToken = async (): Promise<string | null> => {
  const user = await userManager.getUser();
  if (!user || user.expired) return null;
  return user.access_token;
};

export const currentUsername = (user: User | null): string | null =>
  (user?.profile?.preferred_username as string | undefined) ?? null;
