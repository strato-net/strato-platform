import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { api } from '@/lib/axios';
import {
  OwnedNFT,
  NFTItem,
  TransferNFTParams,
  BurnNFTParams,
} from '@strato/shared-types';
import { useUser } from '@/context/UserContext';

// Collection creation and minting are performed on-chain directly (admin/issuer calls the
// NFTFactory / NFT contract), not through the app — so this context exposes reads plus the
// owner-facing transfer/burn actions only.
type NFTContextType = {
  ownedNFTs: OwnedNFT[];
  loadingOwned: boolean;
  getOwnedNFTs: () => Promise<OwnedNFT[]>;
  getNFTItem: (collectionAddress: string, tokenId: string) => Promise<NFTItem>;
  transferNFT: (payload: TransferNFTParams) => Promise<void>;
  burnNFT: (payload: BurnNFTParams) => Promise<void>;
};

const NFTContext = createContext<NFTContextType | undefined>(undefined);

export const NFTProvider = ({ children }: { children: ReactNode }) => {
  const { isLoggedIn } = useUser();
  const [ownedNFTs, setOwnedNFTs] = useState<OwnedNFT[]>([]);
  const [loadingOwned, setLoadingOwned] = useState(false);

  // Clear owned NFTs on logout so a session-expiry (which may not trigger a full-page nav)
  // doesn't leave one account's NFTs visible to the next.
  useEffect(() => {
    if (!isLoggedIn) setOwnedNFTs([]);
  }, [isLoggedIn]);

  const getOwnedNFTs = useCallback(async (): Promise<OwnedNFT[]> => {
    if (!isLoggedIn) {
      setOwnedNFTs([]);
      return [];
    }
    setLoadingOwned(true);
    try {
      const { data } = await api.get<OwnedNFT[]>('/nfts/owned');
      setOwnedNFTs(data);
      return data;
    } finally {
      setLoadingOwned(false);
    }
  }, [isLoggedIn]);

  const getNFTItem = useCallback(async (collectionAddress: string, tokenId: string): Promise<NFTItem> => {
    const { data } = await api.get<NFTItem>(`/nfts/${collectionAddress}/tokens/${tokenId}`);
    return data;
  }, []);

  const transferNFT = useCallback(
    async ({ collectionAddress, to, tokenId }: TransferNFTParams) => {
      await api.post(`/nfts/${collectionAddress}/transfer`, { to, tokenId });
      await getOwnedNFTs();
    },
    [getOwnedNFTs]
  );

  const burnNFT = useCallback(
    async ({ collectionAddress, tokenId }: BurnNFTParams) => {
      await api.post(`/nfts/${collectionAddress}/burn`, { tokenId });
      await getOwnedNFTs();
    },
    [getOwnedNFTs]
  );

  return (
    <NFTContext.Provider
      value={{
        ownedNFTs,
        loadingOwned,
        getOwnedNFTs,
        getNFTItem,
        transferNFT,
        burnNFT,
      }}
    >
      {children}
    </NFTContext.Provider>
  );
};

export const useNFTContext = (): NFTContextType => {
  const context = useContext(NFTContext);
  if (!context) throw new Error('useNFTContext must be used within an NFTProvider');
  return context;
};
