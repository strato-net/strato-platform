"use client";

// context/UserContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect, useWalletClient } from "wagmi";
import { api, setAppAuthenticated, setConnectedWalletAddress, setWalletSigner } from "@/lib/axios";
import { isAuthenticated, logout as authLogout, redirectToSignedOutLanding, WALLET_CONNECT_REQUEST_EVENT } from "@/lib/auth";
import { ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE } from "@/lib/constants";
import { readAttribution, clearAttribution } from "@/lib/attribution";
import { trackWalletConnected } from "@/lib/tracking";
import { ensureStratoChainInWallet } from "@/lib/stratoChain";

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
  /**
   * True once the wagmi wallet client is resolved and the axios STRATO-tx
   * signer is installed. Components that submit STRATO transactions in
   * external-signing mode must wait for this to be true; otherwise the
   * /api/rpc/submit interceptor will throw "No wallet signer available".
   */
  walletSignerReady: boolean;
  openIssues: object;
  openIssuesLoading: boolean;
  getOpenIssues: () => Promise<void>;
  executedIssues: object;
  executedIssuesLoading: boolean;
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
  const [executedIssues, setExecutedIssues] = useState<object>({})
  const [executedIssuesLoading, setExecutedIssuesLoading] = useState<boolean>(false);
  const [contractSearchResults, setContractSearchResults] = useState<object[]>([])
  const [contractSearchResultsLoading, setContractSearchResultsLoading] = useState<boolean>(false)
  const [contractDetailsResults, setContractDetailsResults] = useState<object>({});
  const [contractDetailsResultsLoading, setContractDetailsResultsLoading] = useState<boolean>(false);
  const [walletSignerReady, setWalletSignerReady] = useState<boolean>(false);
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

            // GA4 attribution: tag all subsequent events with user_id, and fire
            // signup_completed exactly once for brand-new users.
            const gtag = (window as any).gtag;
            if (gtag && newUserAddress) {
              gtag('set', { user_id: newUserAddress });
              if (data.isNewUser) {
                const attribution = readAttribution() ?? {};
                gtag('event', 'signup_completed', {
                  utm_source: (attribution as any).utm_source ?? '(direct)',
                  utm_medium: (attribution as any).utm_medium ?? '(none)',
                  utm_campaign: (attribution as any).utm_campaign ?? '(none)',
                  utm_content: (attribution as any).utm_content ?? '(none)',
                  via: (attribution as any).via ?? '(none)',
                  landing_url: (attribution as any).landing_url ?? null,
                  referrer: (attribution as any).referrer ?? null,
                });
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
      await getOpenIssues();
      // Show the recently executed issue
      await getExecutedIssues(1, ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE);
    } catch (error) {
      await getOpenIssues();
      throw error;
    }
  };

  const getOpenIssues = async () => {
    try {
      setOpenIssuesLoading(true);
      try {
        const response = await api.get('/user/admin/issues');
        setOpenIssues(response?.data || {});
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
  // Uniform address source: the connected wagmi account (both the STRATO/vault
  // connector and external EVM wallets publish their address there), falling back
  // to the vault-derived address only for the brief window before wagmi hydrates.
  const userAddress = externalWalletAddress ?? stratoAddress;
  const effectiveLoggedIn = isLoggedIn || shouldUseExternalWallet;

  useEffect(() => {
    setConnectedWalletAddress(externalWalletAddress);
  }, [externalWalletAddress]);

  // Tracking-links beacon: fires when a wallet or STRATO account becomes
  // available, whichever arrives first (guest wallet connects included).
  // Deduped per address inside trackWalletConnected, so the STRATO connector
  // surfacing the same address via wagmi and OAuth reports only once.
  useEffect(() => {
    if (!externalWalletAddress && !stratoAddress) return;
    trackWalletConnected({
      externalWalletAddress,
      stratoAddress,
      connector: account.connector?.id ?? account.connector?.name ?? null,
    });
  }, [externalWalletAddress, stratoAddress, account.connector?.id]);

  useEffect(() => {
    externalEvmConnectedRef.current = isExternalEvmWalletConnected;
  }, [isExternalEvmWalletConnected]);

  useEffect(() => {
    setAppAuthenticated(isLoggedIn);
  }, [isLoggedIn]);

  useEffect(() => {
    const openWalletConnect = () => {
      if (!account.isConnected) openConnectModal?.();
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
      setWalletSignerReady(true);
    } else {
      setWalletSigner(null);
      setWalletSignerReady(false);
    }
  }, [account.isConnected, account.address, walletClient]);

  const setUserAddress = (addr: string | null) => setStratoAddress(addr);

  const refreshAuth = () => {
    checkAuthenticationStatus();
  };

  const handleLogout = useCallback(() => {
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
    walletSignerReady,
    openIssuesLoading,
    openIssues,
    getOpenIssues,
    executedIssues,
    executedIssuesLoading,
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
  }), [
    userAddress, stratoAddress,
    externalWalletAddress, isExternalWalletConnected,
    externalEvmWalletAddress, isExternalEvmWalletConnected,
    effectiveLoggedIn, isLoggedIn, isAdmin, loading, userName, walletSignerReady,
    handleLogout,
    openIssues, openIssuesLoading, getOpenIssues, executedIssues, executedIssuesLoading, getExecutedIssues,
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
