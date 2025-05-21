"use client";

// context/UserContext.tsx
import { createContext, useContext, useEffect, useState } from "react";
import axios from "axios";
import {api} from "@/lib/axios";

interface UserContextType {
  userAddress: string | null;
  setUserAddress: (address: string | null) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const [userAddress, setUserAddress] = useState<string | null>(null);

  useEffect(() => {
    api.get('/users/me')
      .then(response => {        
        localStorage.setItem("user", JSON.stringify(response.data));
        setUserAddress(response.data.userAddress);
      })
      .catch(error => {
        console.error('Error fetching user data:', error);
      });
  }, []);

  return (
    <UserContext.Provider value={{ userAddress, setUserAddress }}>
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
