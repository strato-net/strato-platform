import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';

const InventoryStateContext = createContext();
const InventoryDispatchContext = createContext();

const InventoriesProvider = ({ children }) => {
  const initialState = {
    inventory: null,
    isCreateInventorySubmitting: false,
    inventories: [],
    supportedTokens: [],
    inventoriesTotal: 10,
    isInventoriesLoading: false,
    inventoryUpdateObject: null,
    isinventoryUpdating: false,
    isListing: false,
    isUnlisting: false,
    isReselling: false,
    userInventories: [],
    userInventoriesTotal: 0,
    isUserInventoriesLoading: false,
    isTransferring: false,
    isFetchingTokens: false,
    isBridging: false,
   //------------------------
    isStaking: false,
    isUnstaking: false,
    isEscrowLoading: false,
    isReservesLoading: false,
    isFetchingOracle: false,
    reserves: null,
    reserve: null,
    escrow: null,
    isReserveLoading: false,
    oracle : null,
    totalCataReward: 0,
    dailyCataReward: 0,
    isUserCataRewardsLoading: false,
    isBorrowing: false,
    isRepaying: false,
    //------------------------
    inventoryDetails: null,
    inventoryOwnershipHistory: [],
    isInventoryDetailsLoading: false,
    isInventoryOwnershipHistoryLoading: false,
    error: undefined,
    success: false,
    message: null,
    uploadedImg: null,
    isUploadImageSubmitting: false,
    isTransferringItems: false,
    itemTransfers: [],
    totalItemsTransfered: 0,
    isFetchingItemTransfers: false,
    isFetchingPriceHistory: false,
    priceHistory: [],
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <InventoryStateContext.Provider value={state}>
      <InventoryDispatchContext.Provider value={dispatch}>
        {children}
      </InventoryDispatchContext.Provider>
    </InventoryStateContext.Provider>
  );
};

const useInventoryState = () => {
  const context = useContext(InventoryStateContext);
  if (context === undefined) {
    throw new Error(
      `'useInventoryState' must be used within a InventorysProvider`
    );
  }
  return context;
};

const useInventoryDispatch = () => {
  const context = useContext(InventoryDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useInventoryDispatch' must be used within a InventorysProvider`
    );
  }
  return context;
};

const useInventoryUnit = () => {
  return [useInventoryState(), useInventoryDispatch()];
};

export {
  useInventoryDispatch,
  useInventoryState,
  useInventoryUnit,
  InventoriesProvider,
};
