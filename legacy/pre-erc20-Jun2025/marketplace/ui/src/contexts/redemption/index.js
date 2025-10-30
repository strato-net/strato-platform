import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';

const RedemptionStateContext = createContext();
const RedemptionDispatchContext = createContext();

const RedemptionsProvider = ({ children }) => {
  const initialState = {
    error: undefined,
    success: false,
    message: null,
    redemptionServices: [],
    isFetchingRedemptionServices: false,
    isRequestingRedemption: false,
    isFetchingOutgoingRedemptions: false,
    isFetchingIncomingRedemptions: false,
    outgoingRedemptions: [],
    incomingRedemptions: [],
    isFetchingRedemptionDetails: false,
    redemption: undefined,
    isClosingRedemption: false,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <RedemptionStateContext.Provider value={state}>
      <RedemptionDispatchContext.Provider value={dispatch}>
        {children}
      </RedemptionDispatchContext.Provider>
    </RedemptionStateContext.Provider>
  );
};

const useRedemptionState = () => {
  const context = useContext(RedemptionStateContext);
  if (context === undefined) {
    throw new Error(
      `'useRedemptionState' must be used within a RedemptionsProvider`
    );
  }
  return context;
};

const useRedemptionDispatch = () => {
  const context = useContext(RedemptionDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useRedemptionDispatch' must be used within a RedemptionsProvider`
    );
  }
  return context;
};

const useRedemptionUnit = () => {
  return [useRedemptionState(), useRedemptionDispatch()];
};

export {
  useRedemptionDispatch,
  useRedemptionState,
  useRedemptionUnit,
  RedemptionsProvider,
};
