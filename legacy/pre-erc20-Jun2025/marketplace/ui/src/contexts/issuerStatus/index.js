import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';
import { ISSUER_STATUS } from '../../helpers/constants';

const IssuerStatusStateContext = createContext();
const IssuerStatusDispatchContext = createContext();

const IssuerStatusProvider = ({ children }) => {
  const initialState = {
    success: false,
    message: null,
    issuerStatus: ISSUER_STATUS.NULL,
    changingIssuerStatus: false,
    requestingReview: false,
    changingAdminStatus: false,
  };
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <IssuerStatusStateContext.Provider value={state}>
      <IssuerStatusDispatchContext.Provider value={dispatch}>
        {children}
      </IssuerStatusDispatchContext.Provider>
    </IssuerStatusStateContext.Provider>
  );
};

const useIssuerStatusState = () => {
  const context = useContext(IssuerStatusStateContext);
  if (context == undefined) {
    throw new Error(
      `'useIssuerStatusState' must be used within a IssuerStatusProvider`
    );
  }
  return context;
};

const useIssuerStatusDispatch = () => {
  const context = useContext(IssuerStatusDispatchContext);
  if (context == undefined) {
    throw new Error(
      `'useIssuerStatusDispatch' must be used within a IssuerStatusProvider`
    );
  }
  return context;
};

export { useIssuerStatusState, useIssuerStatusDispatch, IssuerStatusProvider };
