import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const OfferStateContext = createContext();
const OfferDispatchContext = createContext();

const OffersProvider = ({ children }) => {
  const initialState = {
    offer: null,
    isCreateOfferSubmitting: false,
    offers: [],
    isOffersLoading: false,
    error: undefined,
    success: false,
    message: null,
    incomingOffers: [],
    isIncomingOffersLoading: false,
    outgoingOffers: [],
    isOutgoingOffersLoading: false,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <OfferStateContext.Provider value={state}>
      <OfferDispatchContext.Provider value={dispatch}>
        {children}
      </OfferDispatchContext.Provider>
    </OfferStateContext.Provider>
  );
};

const useOfferState = () => {
  const context = useContext(OfferStateContext);
  if (context === undefined) {
    throw new Error(
      `'useOfferState' must be used within an OffersProvider`
    );
  }
  return context;
};

const useOfferDispatch = () => {
  const context = useContext(OfferDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useOfferDispatch' must be used within an OffersProvider`
    );
  }
  return context;
};

const useOfferUnit = () => {
  return [useOfferState(), useOfferDispatch()];
};

export {
  useOfferDispatch,
  useOfferState,
  useOfferUnit,
  OffersProvider,
};
