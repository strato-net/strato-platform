"use client";

// context/UserContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { api, setConnectedWalletAddress, setWalletSigner } from "@/lib/axios";
import { isAuthenticated, logout } from "@/lib/auth";
import { ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE } from "@/lib/constants";

interface UserContextType {
  userAddress: string | null;
  setUserAddress: (address: string | null) => void;
  isLoggedIn: boolean;
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
  executeIssue: (target: string, func: string, args: unknown[]) => Promise<void>;
  withdrawVote: (target: string, func: string, args: unknown[]) => Promise<void>;
  dismissIssue: (issueId: string) => Promise<void>;
  addAdmin: (userAddress: string) => Promise<void>;
  removeAdmin: (userAddress: string) => Promise<void>;
  addGuardian: (userAddress: string) => Promise<void>;
  removeGuardian: (userAddress: string) => Promise<void>;
}

type UnsignedWalletTx = {
  data: {
    to: string;
    functionName: string;
    args: string[];
    nonce: string | number | bigint;
    gasLimit: string | number | bigint;
    network: string;
  };
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const account = useAccount();
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
            const response = await api.get('/user/me');
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

  const castVoteOnIssue = async (target: string, func: string, args: unknown[]) => {
    try {
      await api.post('/user/admin/vote', { target, func, args });
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
      await api.post('/user/admin/vote/by-id', { issueId });
      await getOpenIssues();
      // Show the recently executed issue
      await getExecutedIssues(1, ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE);
    } catch (error) {
      await getOpenIssues();
      throw error;
    }
  };

  const executeIssue = async (target: string, func: string, args: unknown[]) => {
    try {
      await api.post('/user/admin/issues/execute', { target, func, args });
      await getOpenIssues();
      await getExecutedIssues(1, ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE);
    } catch (error) {
      await getOpenIssues();
      throw error;
    }
  };

  const withdrawVote = async (target: string, func: string, args: unknown[]) => {
    try {
      await api.post('/user/admin/vote/withdraw', { target, func, args });
      await getOpenIssues();
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
        // Keep the previous issue state if refresh fails.
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
        // Keep the previous executed issue state if refresh fails.
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
        // Keep the previous search results if refresh fails.
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
        // Keep the previous contract details if refresh fails.
      }
    } finally {
      setContractDetailsResultsLoading(false);
    }
  };

  const addAdmin = async (userAddress: string) => {
    await api.post('/user/admin', { userAddress });
    await getOpenIssues();
  };

  const removeAdmin = async (userAddress: string) => {
    await api.delete('/user/admin', { data: { userAddress } });
    await getOpenIssues();
  };

  const addGuardian = async (userAddress: string) => {
    await api.post('/user/admin/guardian', { userAddress });
    await getOpenIssues();
  };

  const removeGuardian = async (userAddress: string) => {
    await api.delete('/user/admin/guardian', { data: { userAddress } });
    await getOpenIssues();
  };

  const dismissIssue = async (issueId: string) => {
    await api.post('/user/admin/dismiss', { issueId });
    await getOpenIssues();
  };

  const userAddress = account.isConnected && account.address ? account.address : stratoAddress;
  const effectiveLoggedIn = isLoggedIn || (account.isConnected && !!account.address);

  useEffect(() => {
    const connected = account.isConnected && account.address;
    setConnectedWalletAddress(connected ? account.address : null);
    if (connected && walletClient) {
      setWalletSigner(async (unsignedTx: UnsignedWalletTx) => {
        const d = unsignedTx.data;
        const typedData = {
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
        } as const;
        return walletClient.signTypedData(typedData as unknown as Parameters<typeof walletClient.signTypedData>[0]);
      });
    } else {
      setWalletSigner(null);
    }
  }, [account.isConnected, account.address, walletClient]);

  const setUserAddress = (addr: string | null) => setStratoAddress(addr);

  const refreshAuth = () => {
    checkAuthenticationStatus();
  };

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
    setUserAddress,
    userName,
    isLoggedIn: effectiveLoggedIn,
    isAdmin,
    logout,
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
    executeIssue,
    withdrawVote,
    dismissIssue,
    addAdmin,
    removeAdmin,
    addGuardian,
    removeGuardian,
    contractSearch,
    contractSearchResults,
    contractSearchResultsLoading,
    getContractDetails,
    contractDetailsResults,
    contractDetailsResultsLoading,
  }), [userAddress, effectiveLoggedIn, isAdmin, loading, userName,
    openIssues, openIssuesLoading, getOpenIssues, executedIssues, executedIssuesLoading, getExecutedIssues,
    castVoteOnIssue, castVoteOnIssueById, executeIssue, withdrawVote, dismissIssue, addAdmin, removeAdmin, addGuardian, removeGuardian,
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
