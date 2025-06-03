"use client";

// context/UserContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/axios";
import { isAuthenticated, logout } from "@/lib/auth";

interface UserContextType {
  userAddress: string | null;
  setUserAddress: (address: string | null) => void;
  isLoggedIn: boolean;
  logout: () => void;
  refreshAuth: () => void;
  loading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const checkAuthenticationStatus = async () => {
    try {
      setLoading(true);
      const authenticated = await isAuthenticated();
      
      if (authenticated !== isLoggedIn) {
        setIsLoggedIn(authenticated);
      }
      
      // If authenticated and we don't have user data, try to get it
      if (authenticated && !userAddress) {
        try {
          const response = await api.get('/users/me');
          localStorage.setItem("user", JSON.stringify(response.data));
          setUserAddress(response.data.userAddress);
        } catch (error) {
          // If we can't fetch user details but auth check passed, 
          // still consider user as authenticated
        }
      } else if (!authenticated && userAddress) {
        // Clear user data if not authenticated
        localStorage.removeItem("user");
        setUserAddress(null);
      }
    } catch (error) {
      setIsLoggedIn(false);
    } finally {
      setLoading(false);
    }
  };

  const refreshAuth = () => {
    checkAuthenticationStatus();
  };

  useEffect(() => {
    checkAuthenticationStatus();
    
    // Check authentication status periodically
    const interval = setInterval(() => {
      checkAuthenticationStatus();
    }, 30000); // Check every 30 seconds
    
    return () => clearInterval(interval);
  }, []);

  return (
    <UserContext.Provider value={{ userAddress, setUserAddress, isLoggedIn, logout, refreshAuth, loading }}>
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
