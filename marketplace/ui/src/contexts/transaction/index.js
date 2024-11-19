import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';

const TransactionStateContext = createContext();
const TransactionDispatchContext = createContext();

const TransactionsProvider = ({ children }) => {
  const initialState = {
    error: undefined,
    success: false,
    message: null,
    isTransactionLoading: false,
    userTransactions: [],
    globalTransactions: [],
    count: 0,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <TransactionStateContext.Provider value={state}>
      <TransactionDispatchContext.Provider value={dispatch}>
        {children}
      </TransactionDispatchContext.Provider>
    </TransactionStateContext.Provider>
  );
};

const useTransactionState = () => {
  const context = useContext(TransactionStateContext);
  if (context === undefined) {
    throw new Error(
      `'useTransactionState' must be used within a TransactionsProvider`
    );
  }
  return context;
};

const useTransactionDispatch = () => {
  const context = useContext(TransactionDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useTransactionDispatch' must be used within a TransactionsProvider`
    );
  }
  return context;
};

const useTransactionUnit = () => {
  return [useTransactionState(), useTransactionDispatch()];
};

export {
  useTransactionDispatch,
  useTransactionState,
  useTransactionUnit,
  TransactionsProvider,
};
