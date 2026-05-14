"use client";

// context/UserContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect, useWalletClient } from "wagmi";
import { api, setAppAuthenticated, setConnectedWalletAddress, setWalletSigner } from "@/lib/axios";
import { isAuthenticated, logout as authLogout, WALLET_CONNECT_REQUEST_EVENT } from "@/lib/auth";
import { ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE } from "@/lib/constants";
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

  const checkAuthenticationStatus = async (initialCheck = false) => {
    try {
      if (initialCheck) setLoading(true); // Only show loader on first load
      const authenticated = await isAuthenticated();

      if (authenticated !== isLoggedIn) {
        setIsLoggedIn(authenticated);
      }

      // If authenticated and we don't have user data, try to get it
      if (authenticated) {
        const storedUser = localStorage.getItem("user");
        if (!storedUser || !stratoAddress) {
          try {
            const response = await api.get('/user/me', { walletAuth: false } as any);
            const newUserAddress = response.data.userAddress;
            const serverIsAdmin = response.data.isAdmin;
            const userName = response.data.userName
            setUserName(userName)
            if (newUserAddress !== stratoAddress) {
              localStorage.setItem("user", JSON.stringify(response.data));
              setStratoAddress(newUserAddress);
            }
            if (serverIsAdmin !== isAdmin) {
              setIsAdmin(serverIsAdmin);
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
      } else {
        if (stratoAddress) {
          localStorage.removeItem("user");
          setStratoAddress(null);
          setIsAdmin(false);
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
  const shouldUseExternalWallet = !loading && !isLoggedIn && isExternalWalletConnected;
  const userAddress = isLoggedIn ? stratoAddress : shouldUseExternalWallet ? externalWalletAddress : null;
  const effectiveLoggedIn = isLoggedIn || shouldUseExternalWallet;

  useEffect(() => {
    setConnectedWalletAddress(externalWalletAddress);
  }, [externalWalletAddress]);

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
    } else {
      setWalletSigner(null);
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
  }), [userAddress, stratoAddress, externalWalletAddress, isExternalWalletConnected, externalEvmWalletAddress, isExternalEvmWalletConnected, effectiveLoggedIn, isLoggedIn, isAdmin, loading, userName,
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
