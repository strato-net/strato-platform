"use client";

// context/UserContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/axios";
import { isAuthenticated, logout } from "@/lib/auth";

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

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [userName, setUserName] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true);
  const [openIssues, setOpenIssues] = useState<object>({})
  const [openIssuesLoading, setOpenIssuesLoading] = useState<boolean>(false);
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
        if (!storedUser || !userAddress) {
          try {
            const response = await api.get('/user/me');
            const newUserAddress = response.data.userAddress;
            const serverIsAdmin = response.data.isAdmin;
            const userName = response.data.userName
            setUserName(userName)
            if (newUserAddress !== userAddress) {
              localStorage.setItem("user", JSON.stringify(response.data));
              setUserAddress(newUserAddress);
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
          if (userData.userAddress !== userAddress) {
            setUserAddress(userData.userAddress);
          }
          if (userData.isAdmin !== undefined && userData.isAdmin !== isAdmin) {
            setIsAdmin(userData.isAdmin);
          }
        }
      } else {
        // User session expired - if they were logged in, redirect to hero page
        if (userAddress) {
          localStorage.removeItem("user");
          setUserAddress(null);
          setIsAdmin(false);
          // Redirect to hero page when session expires for previously logged-in users
          window.location.href = '/';
          return;
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
      await api.post('/user/admin/vote', { target, func, args });
      await getOpenIssues();
    } catch (error) {
      await getOpenIssues();
      throw error;
    }
  };

  const castVoteOnIssueById = async (issueId: string) => {
    try {
      await api.post('/user/admin/vote/by-id', { issueId });
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
      }
    } finally {
      setOpenIssuesLoading(false);
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
    await api.post('/user/admin', { userAddress });
    await getOpenIssues();
  };

  const removeAdmin = async (userAddress: string) => {
    await api.delete('/user/admin', { data: { userAddress } });
    await getOpenIssues();
  };

  const dismissIssue = async (issueId: string) => {
    await api.post('/user/admin/dismiss', { issueId });
    await getOpenIssues();
  };

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
    isLoggedIn,
    isAdmin,
    logout,
    refreshAuth,
    loading,
    openIssuesLoading,
    openIssues,
    getOpenIssues,
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
  }), [userAddress, isLoggedIn, isAdmin, loading, userName,
    openIssues, openIssuesLoading, getOpenIssues, castVoteOnIssue, castVoteOnIssueById, dismissIssue, addAdmin, removeAdmin,
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
