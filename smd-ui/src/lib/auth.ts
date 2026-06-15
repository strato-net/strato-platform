import { getCsrfToken } from "./csrf";
import { env } from "./env";

export const WALLET_CONNECT_REQUEST_EVENT = "smd:wallet-connect-request";
export const PENDING_STRATO_WALLET_CONNECT_KEY = "smd:pending-strato-wallet-connect";

export interface StratoUser {
  userAddress: string;
  userName: string;
  isAdmin: boolean;
  isNewUser?: boolean;
}

/**
 * Resolve the current STRATO identity from apex. nginx-packager OIDC-protects
 * /smd/ and injects the access token; apex's POST /apex-api/user maps that token
 * to a vault-managed key (get-or-create) and returns the address + username.
 * Returns null when the session is not authenticated (401 / redirect).
 */
export const fetchStratoUser = async (): Promise<StratoUser | null> => {
  try {
    const csrf = getCsrfToken();
    const res = await fetch(`${env.APEX_URL}/user`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: "{}",
      // Don't follow the OIDC login redirect for a background probe.
      redirect: "manual",
    });
    if (!res.ok || res.type === "opaqueredirect") return null;
    const data = await res.json();
    const address: string | undefined = data.address || data.userAddress;
    if (!address) return null;
    return {
      userAddress: address.startsWith("0x") ? address : `0x${address}`,
      userName: data.username || data.userName || "",
      isAdmin: Boolean(data.isAdmin),
      isNewUser: Boolean(data.isNewUser),
    };
  } catch {
    return null;
  }
};

/** Probe authentication status without triggering the 401 interceptor. */
export const isAuthenticated = async (): Promise<{ authenticated: boolean; user?: StratoUser }> => {
  const user = await fetchStratoUser();
  return user ? { authenticated: true, user } : { authenticated: false };
};

/** Logout via the nginx OIDC logout endpoint. */
export const logout = (): void => {
  window.location.href = "/auth/logout";
};

/** Redirect to OIDC login, preserving the current path for return after auth. */
export const redirectToLogin = (returnTo?: string): void => {
  const theme = localStorage.getItem("theme") || "light";
  const params = new URLSearchParams({ theme });
  const path = returnTo ?? window.location.pathname + window.location.search;
  if (path && path !== "/" && path !== "/smd/") {
    params.set("returnTo", path);
  }
  window.location.href = `/login?${params.toString()}`;
};

/** Passive session expiry: drop to the signed-out dashboard without a new login flow. */
export const redirectToSignedOutLanding = (): void => {
  window.location.replace("/smd/");
};

export const requestWalletConnection = (): void => {
  window.dispatchEvent(new CustomEvent(WALLET_CONNECT_REQUEST_EVENT));
};
