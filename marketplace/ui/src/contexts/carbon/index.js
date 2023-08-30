import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const CarbonStateContext = createContext();
const CarbonDispatchContext = createContext();

const CarbonProvider = ({ children }) => {
  const initialState = {
    carbon: null,
    isCreateCarbonSubmitting: false,
    carbons: [],
    isCarbonsLoading: false,
    error: undefined,
    success: false,
    message: null,
    carbonDetails: null,
    isCarbonDetailsLoading: false,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <CarbonStateContext.Provider value={state}>
      <CarbonDispatchContext.Provider value={dispatch}>
        {children}
      </CarbonDispatchContext.Provider>
    </CarbonStateContext.Provider>
  );
};

const useCarbonState = () => {
  const context = useContext(CarbonStateContext);
  if (context === undefined) {
    throw new Error(
      `'useCarbonState' must be used within a CarbonProvider`
    );
  }
  return context;
};

const useCarbonDispatch = () => {
  const context = useContext(CarbonDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useCarbonDispatch' must be used within a CarbonProvider`
    );
  }
  return context;
};

const useCarbonUnit = () => {
  return [useCarbonState(), useCarbonDispatch()];
};

export {
  useCarbonDispatch,
  useCarbonState,
  useCarbonUnit,
  CarbonProvider,
};