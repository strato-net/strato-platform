import { useState, useEffect, useMemo, useRef } from 'react';
import { RiskLevel } from './useLiquidationAlert';

const STORAGE_PREFIX = 'liquidationAlertDismissed';
export const LAST_USER_ADDRESS_KEY = 'liquidationAlertLastUserAddress';

const getStorageKey = (userAddress: string | null, riskLevel: RiskLevel): string | null => {
  return userAddress ? `${STORAGE_PREFIX}_${userAddress}_${riskLevel}` : null;
};

const getStorageItem = (key: string | null): string | null => {
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setStorageItem = (key: string | null, value: string): void => {
  if (!key) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors
  }
};

const removeStorageItem = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
};

// Clear all dismissed entries for a specific user
export const clearDismissedForUser = (userAddress: string | null): void => {
  if (!userAddress) return;
  try {
    const prefix = `${STORAGE_PREFIX}_${userAddress}_`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage errors
  }
};

export const useLiquidationDismiss = (
  riskLevel: RiskLevel,
  userAddress: string | null,
  isLoggedIn: boolean
): { isDismissed: boolean; dismiss: () => void } => {
  const storageKey = useMemo(
    () => getStorageKey(userAddress, riskLevel),
    [userAddress, riskLevel]
  );

  const previousUserAddressRef = useRef<string | null>(null);
  const isInitialMountRef = useRef(true);

  const [isDismissed, setIsDismissed] = useState(() => {
    if (!isLoggedIn || !userAddress) return false;
    
    // Check if this is a new login (different userAddress)
    const lastUserAddress = getStorageItem(LAST_USER_ADDRESS_KEY);
    if (lastUserAddress && lastUserAddress !== userAddress) {
      clearDismissedForUser(lastUserAddress);
    }
    setStorageItem(LAST_USER_ADDRESS_KEY, userAddress);
    
    const key = getStorageKey(userAddress, riskLevel);
    return getStorageItem(key) === 'true';
  });

  useEffect(() => {
    const previousUserAddress = previousUserAddressRef.current;
    const isLoggedOut = !isLoggedIn || !userAddress;

    // Handle initial mount
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      previousUserAddressRef.current = userAddress;
      if (isLoggedOut) {
        setIsDismissed(false);
        return;
      }
      setIsDismissed(getStorageItem(storageKey) === 'true');
      return;
    }

    // Handle logout
    if (isLoggedOut) {
      if (previousUserAddress) {
        clearDismissedForUser(previousUserAddress);
        removeStorageItem(LAST_USER_ADDRESS_KEY);
      }
      setIsDismissed(false);
      previousUserAddressRef.current = null;
      return;
    }

    // Handle login or user switch
    if (previousUserAddress !== userAddress) {
      // Clear previous user's entries if user switched
      if (previousUserAddress) {
        clearDismissedForUser(previousUserAddress);
      }
      
      // Only clear current user's entries if this is a NEW login (different from stored)
      // Don't clear on refresh (when previousUserAddress is null but userAddress matches stored)
      const lastUserAddress = getStorageItem(LAST_USER_ADDRESS_KEY);
      if (lastUserAddress !== userAddress) {
        // New login - clear for fresh start
        clearDismissedForUser(userAddress);
        setStorageItem(LAST_USER_ADDRESS_KEY, userAddress);
      } else if (!lastUserAddress) {
        // No stored address - first time login, store it
        setStorageItem(LAST_USER_ADDRESS_KEY, userAddress);
      }
    }

    previousUserAddressRef.current = userAddress;
    setIsDismissed(getStorageItem(storageKey) === 'true');
  }, [isLoggedIn, userAddress, storageKey]);

  const dismiss = () => {
    if (storageKey) {
      setStorageItem(storageKey, 'true');
      setIsDismissed(true);
    }
  };

  return { isDismissed, dismiss };
};
