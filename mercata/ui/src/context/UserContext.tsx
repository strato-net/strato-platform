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
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [userName, setUserName] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true);

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
            const response = await api.get('/users/me');
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
        if (userAddress) {
          localStorage.removeItem("user");
          setUserAddress(null);
          setIsAdmin(false);
        }
      }
    } catch (error) {
      if (isLoggedIn) setIsLoggedIn(false);
    } finally {
      setLoading(false);
    }
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
  }), [userAddress, isLoggedIn, isAdmin, loading, userName]);

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
