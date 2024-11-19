import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';

const PaymentServiceStateContext = createContext();
const PaymentServiceDispatchContext = createContext();

const PaymentServicesProvider = ({ children }) => {
  const initialState = {
    paymentServices: [],
    paymentServicesTotal: 10,
    arePaymentServicesLoading: false,
    notOnboarded: [],
    notOnboardedTotal: 10,
    areNotOnboardedLoading: false,
    error: undefined,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <PaymentServiceStateContext.Provider value={state}>
      <PaymentServiceDispatchContext.Provider value={dispatch}>
        {children}
      </PaymentServiceDispatchContext.Provider>
    </PaymentServiceStateContext.Provider>
  );
};

const usePaymentServiceState = () => {
  const context = useContext(PaymentServiceStateContext);
  if (context === undefined) {
    throw new Error(
      `'usePaymentServiceState' must be used within a PaymentServicesProvider`
    );
  }
  return context;
};

const usePaymentServiceDispatch = () => {
  const context = useContext(PaymentServiceDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'usePaymentServiceDispatch' must be used within a PaymentServicesProvider`
    );
  }
  return context;
};

const usePaymentServiceUnit = () => {
  return [usePaymentServiceState(), usePaymentServiceDispatch()];
};

export {
  usePaymentServiceDispatch,
  usePaymentServiceState,
  usePaymentServiceUnit,
  PaymentServicesProvider,
};
