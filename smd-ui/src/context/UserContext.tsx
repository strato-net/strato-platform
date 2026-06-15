import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect } from "wagmi";
import {
  isAuthenticated,
  logout as authLogout,
  redirectToSignedOutLanding,
  WALLET_CONNECT_REQUEST_EVENT,
} from "@/lib/auth";

interface UserContextType {
  /** Active address — STRATO session address when logged in, else connected external wallet. */
  userAddress: string | null;
  /** Address from a STRATO (vault) login. */
  stratoAddress: string | null;
  /** Connected external wallet address (MetaMask / WalletConnect / Coinbase). */
  externalWalletAddress: string | null;
  isExternalWalletConnected: boolean;
  /** True when authenticated against the STRATO app (vault key), not just an external wallet. */
  isLoggedIn: boolean;
  isAppAuthenticated: boolean;
  isAdmin: boolean;
  userName: string;
  logout: () => void;
  refreshAuth: () => void;
  loading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const isStratoConnector = (connector?: { id?: string; name?: string } | null) =>
  connector?.id === "stratoWallet" || connector?.name === "STRATO Wallet";

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const account = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const [stratoAddress, setStratoAddress] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [userName, setUserName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const sessionExpiryLogoutStartedRef = useRef(false);

  const checkAuthenticationStatus = useCallback(
    async (initialCheck = false) => {
      try {
        if (initialCheck) setLoading(true);
        const { authenticated, user } = await isAuthenticated();

        if (authenticated && user) {
          sessionExpiryLogoutStartedRef.current = false;
          localStorage.setItem("user", JSON.stringify(user));
          setStratoAddress(user.userAddress);
          setUserName(user.userName);
          setIsAdmin(user.isAdmin);
          setIsLoggedIn(true);
        } else {
          const hadSession = !!localStorage.getItem("user") || isLoggedIn;
          localStorage.removeItem("user");
          setStratoAddress(null);
          setUserName("");
          setIsAdmin(false);
          setIsLoggedIn(false);
          if (hadSession) {
            sessionExpiryLogoutStartedRef.current = true;
            try {
              disconnect();
            } catch {
              // continue
            }
            redirectToSignedOutLanding();
          }
        }
      } catch {
        setIsLoggedIn(false);
      } finally {
        setLoading(false);
      }
    },
    [disconnect, isLoggedIn]
  );

  const externalWalletAddress =
    account.isConnected && account.address && !isStratoConnector(account.connector)
      ? account.address
      : null;
  const isExternalWalletConnected = !!externalWalletAddress;
  const shouldUseExternalWallet =
    !sessionExpiryLogoutStartedRef.current && !loading && !isLoggedIn && isExternalWalletConnected;
  const userAddress = isLoggedIn
    ? stratoAddress
    : shouldUseExternalWallet
      ? externalWalletAddress
      : null;
  const effectiveLoggedIn = isLoggedIn || shouldUseExternalWallet;

  useEffect(() => {
    const openWalletConnect = () => {
      if (!account.isConnected) openConnectModal?.();
    };
    window.addEventListener(WALLET_CONNECT_REQUEST_EVENT, openWalletConnect);
    return () => window.removeEventListener(WALLET_CONNECT_REQUEST_EVENT, openWalletConnect);
  }, [account.isConnected, openConnectModal]);

  const handleLogout = useCallback(() => {
    try {
      disconnect();
    } catch {
      // continue
    }
    setStratoAddress(null);
    setIsLoggedIn(false);
    setIsAdmin(false);
    setUserName("");
    localStorage.removeItem("user");
    authLogout();
  }, [disconnect]);

  useEffect(() => {
    checkAuthenticationStatus(true);
    const interval = setInterval(() => checkAuthenticationStatus(false), 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contextValue = useMemo<UserContextType>(
    () => ({
      userAddress,
      stratoAddress,
      externalWalletAddress,
      isExternalWalletConnected,
      isLoggedIn: effectiveLoggedIn,
      isAppAuthenticated: isLoggedIn,
      isAdmin,
      userName,
      logout: handleLogout,
      refreshAuth: () => checkAuthenticationStatus(false),
      loading,
    }),
    [
      userAddress,
      stratoAddress,
      externalWalletAddress,
      isExternalWalletConnected,
      effectiveLoggedIn,
      isLoggedIn,
      isAdmin,
      userName,
      handleLogout,
      loading,
      checkAuthenticationStatus,
    ]
  );

  return <UserContext.Provider value={contextValue}>{children}</UserContext.Provider>;
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
};
