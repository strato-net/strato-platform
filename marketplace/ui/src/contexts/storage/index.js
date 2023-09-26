import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const StorageStateContext = createContext();
const StorageDispatchContext = createContext();

const StorageProvider = ({ children }) => {
  const initialState = {
    error: undefined,
    assets: [],
    sales: [],
    isAssetsLoading: false,
    isSalesLoading: false,
    success: false,
    message: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <StorageStateContext.Provider value={state}>
      <StorageDispatchContext.Provider value={dispatch}>
        {children}
      </StorageDispatchContext.Provider>
    </StorageStateContext.Provider>
  );
};

const useStorageState = () => {
  const context = useContext(StorageStateContext);
  if (context === undefined) {
    throw new Error(
      `'useStorageState' must be used within a StorageProvider`
    );
  }
  return context;
};

const useStorageDispatch = () => {
  const context = useContext(StorageDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useStorageDispatch' must be used within a StorageProvider`
    );
  }
  return context;
};

const useStorageUnit = () => {
  return [useStorageState(), useStorageDispatch()];
};

export {
  useStorageDispatch,
  useStorageState,
  useStorageUnit,
  StorageProvider,
};