"use client";

// context/UserContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect, useWalletClient } from "wagmi";
import { api, setAppAuthenticated, setConnectedWalletAddress, setWalletSigner } from "@/lib/axios";
import { isAuthenticated, logout as authLogout, redirectToSignedOutLanding, WALLET_CONNECT_REQUEST_EVENT } from "@/lib/auth";
import { ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE, ADMIN_VOTE_OPEN_ISSUES_PER_PAGE } from "@/lib/constants";
import { readAttribution, clearAttribution } from "@/lib/attribution";
import { trackWalletConnected } from "@/lib/tracking";
import { capture, identifyUser, resetUser } from "@/lib/analytics";
import { ensureStratoChainInWallet } from "@/lib/stratoChain";
import { clearExternalWalletActive } from "@/lib/stratoWallet";
import { ensureHexPrefix } from "@/utils/numberUtils";

interface UserContextType {
  userAddress: string | null;
  stratoAddress: string | null;
  externalWalletAddress: string | null;
  isExternalWalletConnected: boolean;
  externalEvmWalletAddress: string | null;
  isExternalEvmWalletConnected: boolean;
  setUserAddress: (address: string | null) => void;
  isLoggedIn: boolean;
  isAppAuthenticated: boolean;
  isAdmin: boolean;
  userName: string;
  logout: () => void;
  refreshAuth: () => void;
  loading: boolean;
  openIssues: object;
  openIssuesLoading: boolean;
  openIssuesUpdatedAt: Date | null;
  getOpenIssues: (page?: number, limit?: number) => Promise<void>;
  executedIssues: object;
  executedIssuesLoading: boolean;
  executedIssuesUpdatedAt: Date | null;
  getExecutedIssues: (page?: number, limit?: number) => Promise<void>;
  contractSearchResults: object[];
  contractSearchResultsLoading: boolean;
  contractSearch: (search: string) => Promise<void>;
  contractDetailsResults: object;
  contractDetailsResultsLoading: boolean;
  getContractDetails: (address: string) => Promise<void>;
  castVoteOnIssue: (target: string, func: string, args: string[]) => Promise<void>;
  castVoteOnIssueById: (issueId: string) => Promise<void>;
  dismissIssue: (issueId: string) => Promise<void>;
  addAdmin: (userAddress: string) => Promise<void>;
  removeAdmin: (userAddress: string) => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const isStratoConnector = (connector?: { id?: string; name?: string } | null) =>
  connector?.id === "stratoWallet" || connector?.name === "STRATO Wallet";

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const account = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const [stratoAddress, setStratoAddress] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [userName, setUserName] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true);
  const [openIssues, setOpenIssues] = useState<object>({})
  const [openIssuesLoading, setOpenIssuesLoading] = useState<boolean>(false);
  const [openIssuesUpdatedAt, setOpenIssuesUpdatedAt] = useState<Date | null>(null);
  const [executedIssues, setExecutedIssues] = useState<object>({})
  const [executedIssuesLoading, setExecutedIssuesLoading] = useState<boolean>(false);
  const [executedIssuesUpdatedAt, setExecutedIssuesUpdatedAt] = useState<Date | null>(null);
  const [contractSearchResults, setContractSearchResults] = useState<object[]>([])
  const [contractSearchResultsLoading, setContractSearchResultsLoading] = useState<boolean>(false)
  const [contractDetailsResults, setContractDetailsResults] = useState<object>({});
  const [contractDetailsResultsLoading, setContractDetailsResultsLoading] = useState<boolean>(false);
  const sessionExpiryLogoutStartedRef = useRef(false);
  // Tracks whether a non-STRATO (external EVM) wallet is connected, readable from
  // inside the polled auth check without a stale closure. Such a wallet is its own
  // auth, so an expected 401 from the vault-only /me probe must not log it out.
  const externalEvmConnectedRef = useRef(false);

  const checkAuthenticationStatus = async (initialCheck = false) => {
    try {
      if (initialCheck) setLoading(true); // Only show loader on first load
      const storedUser = localStorage.getItem("user");
      const { authenticated, userData: probedUserData } = await isAuthenticated();

      if (authenticated !== isLoggedIn) {
        setIsLoggedIn(authenticated);
      }

      // If authenticated and we don't have user data, try to get it
      if (authenticated) {
        sessionExpiryLogoutStartedRef.current = false;
        if (!storedUser || !stratoAddress) {
          try {
            // Reuse the body from isAuthenticated()'s probe so we don't issue a
            // second /user/me — that would mask the transient isNewUser flag
            // the backend only returns once, on the call that creates the key.
            const data = probedUserData ?? (await api.get('/user/me', { walletAuth: false } as any)).data;
            const newUserAddress = data.userAddress;
            const serverIsAdmin = data.isAdmin;
            const userName = data.userName
            setUserName(userName)
            if (newUserAddress !== stratoAddress) {
              localStorage.setItem("user", JSON.stringify(data));
              setStratoAddress(newUserAddress);
            }
            if (serverIsAdmin !== isAdmin) {
              setIsAdmin(serverIsAdmin);
            }

            // Analytics attribution: tag all subsequent events with the user,
            // and fire signup_completed exactly once for brand-new users.
            // GA4 and PostHog are kept independent — PostHog must still
            // identify when gtag failed to load (ad blockers, no GA id set) —
            // and attribution is read once and cleared only after both have
            // consumed it.
            if (newUserAddress) {
              const gtag = (window as any).gtag;
              gtag?.('set', { user_id: newUserAddress });
              identifyUser({
                address: newUserAddress,
                userName,
                isAdmin: serverIsAdmin,
              });

              if (data.isNewUser) {
                const attribution = (readAttribution() ?? {}) as Record<string, unknown>;
                const signupProps = {
                  utm_source: attribution.utm_source ?? '(direct)',
                  utm_medium: attribution.utm_medium ?? '(none)',
                  utm_campaign: attribution.utm_campaign ?? '(none)',
                  utm_content: attribution.utm_content ?? '(none)',
                  via: attribution.via ?? '(none)',
                  landing_url: attribution.landing_url ?? null,
                  referrer: attribution.referrer ?? null,
                };
                gtag?.('event', 'signup_completed', signupProps);
                capture('signup_completed', signupProps);
                clearAttribution();
              }
            }
          } catch (error) {
            // If we can't fetch user details but auth check passed, 
            // still consider user as authenticated
          }
        } else {
          // Use stored user data if available
          const userData = JSON.parse(storedUser);
          if (userData.userAddress !== stratoAddress) {
            setStratoAddress(userData.userAddress);
          }
          if (userData.isAdmin !== undefined && userData.isAdmin !== isAdmin) {
            setIsAdmin(userData.isAdmin);
          }
        }
      } else if (externalEvmConnectedRef.current) {
        // Connected external EVM wallet: /me 401 is expected (it has no vault
        // session) and is NOT a session expiry. Clear any residual vault state
        // quietly, but never disconnect the wallet or redirect.
        if (isLoggedIn) setIsLoggedIn(false);
        if (stratoAddress) setStratoAddress(null);
        if (isAdmin) setIsAdmin(false);
        if (userName) setUserName(null);
        localStorage.removeItem("user");
      } else {
        const hadStratoSession = !!storedUser || !!stratoAddress || isLoggedIn;
        if (hadStratoSession) {
          sessionExpiryLogoutStartedRef.current = true;
          localStorage.removeItem("user");
          setStratoAddress(null);
          setIsLoggedIn(false);
          setIsAdmin(false);
          setUserName(null);
          setConnectedWalletAddress(null);
          setWalletSigner(null);
          setAppAuthenticated(false);
          try {
            disconnect();
          } catch {
            // Continue session-expiry logout even if wallet disconnect fails.
          }
          redirectToSignedOutLanding();
          return;
        } else if (stratoAddress) {
          setStratoAddress(null);
          setIsLoggedIn(false);
          setIsAdmin(false);
          setUserName(null);
        }
      }
    } catch (error) {
      if (isLoggedIn) setIsLoggedIn(false);
    } finally {
      setLoading(false);
    }
  };

  const castVoteOnIssue = async (target: string, func: string, args: any[]) => {
    try {
      await api.post('/user/admin/vote', { target, func, args }, { walletAuth: false } as any);
      await getOpenIssues();
      // Show the recently executed issue
      await getExecutedIssues(1, ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE);
    } catch (error) {
      await getOpenIssues();
      throw error;
    }
  };

  const castVoteOnIssueById = async (issueId: string) => {
    try {
      await api.post('/user/admin/vote/by-id', { issueId }, { walletAuth: false } as any);
    } finally {
      await getOpenIssues();
      // Show the recently executed issue
      await getExecutedIssues(1, ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE);
    }
  };

  const getOpenIssues = async (page: number = 1, limit: number = ADMIN_VOTE_OPEN_ISSUES_PER_PAGE) => {
    try {
      setOpenIssuesLoading(true);
      try {
        const response = await api.get('/user/admin/issues', {
          params: {
            page,
            limit,
          },
        });
        setOpenIssues(response?.data || {});
        setOpenIssuesUpdatedAt(new Date());
      } catch (error) {
      }
    } finally {
      setOpenIssuesLoading(false);
    }
  };

  const getExecutedIssues = async (page: number = 1, limit: number = 10) => {
    try {
      setExecutedIssuesLoading(true);
      try {
        const response = await api.get('/user/admin/issues/executed', {
          params: {
            page,
            limit,
          },
        });
        setExecutedIssues(response?.data || {});
        setExecutedIssuesUpdatedAt(new Date());
      } catch (error) {
      }
    } finally {
      setExecutedIssuesLoading(false);
    }
  };

  const contractSearch = async (search: string) => {
    try {
      setContractSearchResultsLoading(true);
      try {
        const response = await api.get(`/user/admin/contract/search?search=${search}`);
        setContractSearchResults(response?.data || []);
      } catch (error) {
      }
    } finally {
      setContractSearchResultsLoading(false);
    }
  };

  const getContractDetails = async (address: string) => {
    try {
      setContractDetailsResultsLoading(true);
      try {
        const response = await api.get(`/user/admin/contract/details?address=${address}`);
        setContractDetailsResults(response?.data || {});
      } catch (error) {
      }
    } finally {
      setContractDetailsResultsLoading(false);
    }
  };

  const addAdmin = async (userAddress: string) => {
    await api.post('/user/admin', { userAddress }, { walletAuth: false } as any);
    await getOpenIssues();
  };

  const removeAdmin = async (userAddress: string) => {
    await api.delete('/user/admin', { data: { userAddress }, walletAuth: false } as any);
    await getOpenIssues();
  };

  const dismissIssue = async (issueId: string) => {
    await api.post('/user/admin/dismiss', { issueId }, { walletAuth: false } as any);
    await getOpenIssues();
  };

  const externalWalletAddress = account.isConnected && account.address ? account.address : null;
  const isExternalWalletConnected = !!externalWalletAddress;
  const externalEvmWalletAddress = !isStratoConnector(account.connector) ? externalWalletAddress : null;
  const isExternalEvmWalletConnected = !!externalEvmWalletAddress;
  const shouldUseExternalWallet = !sessionExpiryLogoutStartedRef.current && !loading && !isLoggedIn && isExternalWalletConnected;
  // The vault identity wins whenever a vault session exists: the backend suppresses the
  // X-Wallet-Address header and resolves data for the vault address, so the UI must not
  // display or filter by an external wallet connected on the Fund page. Guests fall back
  // to the wagmi account. The vault address arrives without a 0x prefix, unlike wagmi's.
  const stratoAddressHex = ensureHexPrefix(stratoAddress) ?? null;
  const userAddress = isLoggedIn ? stratoAddressHex : externalWalletAddress ?? stratoAddressHex;
  const effectiveLoggedIn = isLoggedIn || shouldUseExternalWallet;

  // Layout effect, not a passive one: React runs children's passive effects
  // before the parent's, so a consumer (e.g. the dashboard's member-benefit
  // hook) that fires a request in the same commit that the wallet connects
  // would otherwise go out without X-Wallet-Address. For guest wallets that
  // silently drops the my_activity filter and returns everyone's history.
  useLayoutEffect(() => {
    setConnectedWalletAddress(externalWalletAddress);
  }, [externalWalletAddress]);

  const walletConnectedCapturedRef = useRef<Set<string>>(new Set());
  const WALLET_CONNECTED_CAPTURED_KEY = 'ph_wallet_connected_captured';
  const hasCapturedWalletConnected = (key: string): boolean => {
    if (walletConnectedCapturedRef.current.has(key)) return true;
    try {
      const stored: string[] = JSON.parse(sessionStorage.getItem(WALLET_CONNECTED_CAPTURED_KEY) ?? '[]');
      return stored.includes(key);
    } catch {
      return false;
    }
  };
  const markWalletConnectedCaptured = (key: string): void => {
    walletConnectedCapturedRef.current.add(key);
    try {
      const stored: string[] = JSON.parse(sessionStorage.getItem(WALLET_CONNECTED_CAPTURED_KEY) ?? '[]');
      if (!stored.includes(key)) {
        sessionStorage.setItem(WALLET_CONNECTED_CAPTURED_KEY, JSON.stringify([...stored, key]));
      }
    } catch {
      // sessionStorage unavailable: fall back to the in-memory guard
    }
  };

  // Tracking-links beacon: fires when a wallet or STRATO account becomes
  // available, whichever arrives first (guest wallet connects included).
  // Deduped per address inside trackWalletConnected, so the STRATO connector
  // surfacing the same address via wagmi and OAuth reports only once.
  useEffect(() => {
    if (!externalWalletAddress && !stratoAddress) return;
    const connector = account.connector?.id ?? account.connector?.name ?? null;
    trackWalletConnected({ externalWalletAddress, stratoAddress, connector });

    // trackWalletConnected dedupes inside its own module, so the analytics
    // event needs its own guard: this effect also re-runs when the connector id
    // resolves after the address, which would otherwise double-count. The key
    // strips the 0x prefix because the STRATO connector surfaces the same
    // account prefixed via wagmi and unprefixed via /user/me. The guard is
    // persisted in sessionStorage so a full reload mid-session does not
    // re-report a connection that already happened.
    const key = (stratoAddress ?? externalWalletAddress ?? '').toLowerCase().replace(/^0x/, '');
    if (key && !hasCapturedWalletConnected(key)) {
      markWalletConnectedCaptured(key);
      capture('wallet_connected', {
        connector,
        has_external_wallet: !!externalWalletAddress,
        has_strato_address: !!stratoAddress,
      });
    }
  }, [externalWalletAddress, stratoAddress, account.connector?.id]);

  useEffect(() => {
    externalEvmConnectedRef.current = isExternalEvmWalletConnected;
  }, [isExternalEvmWalletConnected]);

  useLayoutEffect(() => {
    setAppAuthenticated(isLoggedIn);
  }, [isLoggedIn]);

  useEffect(() => {
    const openWalletConnect = () => {
      if (!account.isConnected) {
        capture('wallet_connect_requested');
        openConnectModal?.();
      }
    };

    window.addEventListener(WALLET_CONNECT_REQUEST_EVENT, openWalletConnect);
    return () => window.removeEventListener(WALLET_CONNECT_REQUEST_EVENT, openWalletConnect);
  }, [account.isConnected, openConnectModal]);

  useEffect(() => {
    const connected = account.isConnected && account.address;
    if (connected && walletClient) {
      setWalletSigner(async (unsignedTx: any) => {
        await ensureStratoChainInWallet(walletClient);

        const d = unsignedTx.data;
        return walletClient.signTypedData({
          account: walletClient.account,
          domain: {
            name: "STRATO",
            version: "1",
          },
          types: {
            Transaction: [
              { name: "to", type: "address" },
              { name: "funcName", type: "string" },
              { name: "args", type: "string[]" },
              { name: "nonce", type: "uint256" },
              { name: "gasLimit", type: "uint256" },
              { name: "network", type: "string" },
            ],
          },
          primaryType: "Transaction",
          message: {
            to: `0x${d.to}` as `0x${string}`,
            funcName: d.functionName,
            args: d.args,
            nonce: BigInt(d.nonce),
            gasLimit: BigInt(d.gasLimit),
            network: d.network,
          },
        });
      });
    } else {
      setWalletSigner(null);
    }
  }, [account.isConnected, account.address, walletClient]);

  const setUserAddress = (addr: string | null) => setStratoAddress(addr);

  const refreshAuth = () => {
    checkAuthenticationStatus();
  };

  const handleLogout = useCallback(() => {
    // Mark the logout before any state clears, so the render between setUserName(null) and
    // wagmi's async disconnect does not treat the still-connected wallet as a guest login.
    sessionExpiryLogoutStartedRef.current = true;
    // Without this the flag outlives the session and blocks STRATO auto-reconnect on the
    // next login in this browser.
    clearExternalWalletActive();
    try {
      disconnect();
    } catch {
      // Continue STRATO logout even if wallet disconnect fails.
    }
    setConnectedWalletAddress(null);
    setWalletSigner(null);
    setAppAuthenticated(false);
    setStratoAddress(null);
    setIsLoggedIn(false);
    setIsAdmin(false);
    setUserName(null);
    localStorage.removeItem("user");
    const gtag = (window as any).gtag;
    if (gtag) gtag('set', { user_id: null });
    resetUser();
    authLogout();
  }, [disconnect]);

  useEffect(() => {
    checkAuthenticationStatus(true);

    // Check authentication status periodically
    const interval = setInterval(() => {
      checkAuthenticationStatus(false);
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);


  const contextValue = useMemo(() => ({
    userAddress,
    stratoAddress,
    externalWalletAddress,
    isExternalWalletConnected,
    externalEvmWalletAddress,
    isExternalEvmWalletConnected,
    setUserAddress,
    userName,
    isLoggedIn: effectiveLoggedIn,
    isAppAuthenticated: isLoggedIn,
    isAdmin,
    logout: handleLogout,
    refreshAuth,
    loading,
    openIssuesLoading,
    openIssuesUpdatedAt,
    openIssues,
    getOpenIssues,
    executedIssues,
    executedIssuesLoading,
    executedIssuesUpdatedAt,
    getExecutedIssues,
    castVoteOnIssue,
    castVoteOnIssueById,
    dismissIssue,
    addAdmin,
    removeAdmin,
    contractSearch,
    contractSearchResults,
    contractSearchResultsLoading,
    getContractDetails,
    contractDetailsResults,
    contractDetailsResultsLoading,
  }), [userAddress, stratoAddress, externalWalletAddress, isExternalWalletConnected, externalEvmWalletAddress, isExternalEvmWalletConnected, effectiveLoggedIn, isLoggedIn, isAdmin, loading, userName,
    handleLogout,
    openIssues, openIssuesLoading, openIssuesUpdatedAt, getOpenIssues,
    executedIssues, executedIssuesLoading, executedIssuesUpdatedAt, getExecutedIssues,
    castVoteOnIssue, castVoteOnIssueById, dismissIssue, addAdmin, removeAdmin,
    contractSearch, contractSearchResults, contractSearchResultsLoading,
    getContractDetails, contractDetailsResults, contractDetailsResultsLoading,
  ]);

  return (
    <UserContext.Provider value={contextValue}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
};
