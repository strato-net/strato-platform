import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const VintageStateContext = createContext();
const VintageDispatchContext = createContext();

const VintageProvider = ({ children }) => {
  const initialState = {
    vintage: null,
    isCreateVintageSubmitting: false,
    vintages: [],
    isVintagesLoading: false,
    error: undefined,
    success: false,
    message: null,
    vintageDetails: null,
    isVintageDetailsLoading: false,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <VintageStateContext.Provider value={state}>
      <VintageDispatchContext.Provider value={dispatch}>
        {children}
      </VintageDispatchContext.Provider>
    </VintageStateContext.Provider>
  );
};

const useVintageState = () => {
  const context = useContext(VintageStateContext);
  if (context === undefined) {
    throw new Error(
      `'useVintageState' must be used within a VintageProvider`
    );
  }
  return context;
};

const useVintageDispatch = () => {
  const context = useContext(VintageDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useVintageDispatch' must be used within a VintageProvider`
    );
  }
  return context;
};

const useVintageUnit = () => {
  return [useVintageState(), useVintageDispatch()];
};

export {
  useVintageDispatch,
  useVintageState,
  useVintageUnit,
  VintageProvider,
};