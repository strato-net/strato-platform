import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';

const EthStateContext = createContext();
const EthDispatchContext = createContext();

const EthProvider = ({ children }) => {
  const initialState = {
    error: undefined,
    success: false,
    message: null,
    ethstAddress: null,
    isAddingHash: false,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <EthStateContext.Provider value={state}>
      <EthDispatchContext.Provider value={dispatch}>
        {children}
      </EthDispatchContext.Provider>
    </EthStateContext.Provider>
  );
};

const useEthState = () => {
  const context = useContext(EthStateContext);
  if (context === undefined) {
    throw new Error(`'useEthState' must be used within a EthProvider`);
  }
  return context;
};

const useEthDispatch = () => {
  const context = useContext(EthDispatchContext);
  if (context === undefined) {
    throw new Error(`'useEthDispatch' must be used within a EthsProvider`);
  }
  return context;
};

const useEthUnit = () => {
  return [useEthState(), useEthDispatch()];
};

export { useEthDispatch, useEthState, useEthUnit, EthProvider };
