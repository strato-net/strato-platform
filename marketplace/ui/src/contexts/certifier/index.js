import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const CertifiersStateContext = createContext();
const CertifiersDispatchContext = createContext();

const CertifiersProvider = ({ children }) => {
  const initialState = {
    certifiers: [],
    isCertifiersLoading: false,
    error: undefined,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <CertifiersStateContext.Provider value={state}>
      <CertifiersDispatchContext.Provider value={dispatch}>
        {children}
      </CertifiersDispatchContext.Provider>
    </CertifiersStateContext.Provider>
  );
};

const useCertifiersState = () => {
  const context = useContext(CertifiersStateContext);
  if (context === undefined) {
    throw new Error(
      `'useCertifiersState' must be used within a CertifiersProvider`
    );
  }
  return context;
};

const useCertifiersDispatch = () => {
  const context = useContext(CertifiersDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useCertifiersDispatch' must be used within a CertifiersProvider`
    );
  }
  return context;
};

const useReferenceUnit = () => {
  return [useCertifiersState(), useCertifiersDispatch()];
};

export {
  useCertifiersDispatch,
  useCertifiersState,
  useReferenceUnit,
  CertifiersProvider,
};
