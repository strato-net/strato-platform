import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';

const ItemStateContext = createContext();
const ItemDispatchContext = createContext();

const ItemsProvider = ({ children }) => {
  const initialState = {
    item: null,
    items: [],
    isitemsLoading: false,
    error: undefined,
    success: false,
    message: null,
    serialNumbers: [],
    isSerialNumbersLoading: false,
    ownershipHistory: [],
    isOwnershipHistoryLoading: false,
    rawMaterials: [],
    isRawMaterialsLoading: false,
    actualRawMaterials: [],
    isTransferringItems: false,
    itemTransfers: [],
    totalItemsTransfered: 0,
    isFetchingItemTransfers: false,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <ItemStateContext.Provider value={state}>
      <ItemDispatchContext.Provider value={dispatch}>
        {children}
      </ItemDispatchContext.Provider>
    </ItemStateContext.Provider>
  );
};

const useItemState = () => {
  const context = useContext(ItemStateContext);
  if (context === undefined) {
    throw new Error(`'useItemState' must be used within a ItemsProvider`);
  }
  return context;
};

const useItemDispatch = () => {
  const context = useContext(ItemDispatchContext);
  if (context === undefined) {
    throw new Error(`'useItemDispatch' must be used within a ItemsProvider`);
  }
  return context;
};

const useItemUnit = () => {
  return [useItemState(), useItemDispatch()];
};

export { useItemDispatch, useItemState, useItemUnit, ItemsProvider };
