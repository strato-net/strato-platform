import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const serviceUsageStateContext = createContext();
const serviceUsageDispatchContext = createContext();

const ServiceUsageProvider = ({ children }) => {
  const initialState = {
    servicesUsage: [],
    isServicesUsageLoading: false,
    isCreateServiceUsageSubmitting: false,
    serviceUsageDetail: null,
    isServiceUsageDetailLoading:false,
    isUpdateServicesUsageLoading: false,

    error: undefined,
    success: false,
    message: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <serviceUsageStateContext.Provider value={state}>
      <serviceUsageDispatchContext.Provider value={dispatch}>
        {children}
      </serviceUsageDispatchContext.Provider>
    </serviceUsageStateContext.Provider>
  );
};

const useServiceUsageState = () => {
  const context = useContext(serviceUsageStateContext);
  if (context === undefined) {
    throw new Error(
      `'useServiceUsageState' must be used within a ServiceUsageProvider`
    );
  }
  return context;
};

const useServiceUsageDispatch = () => {
  const context = useContext(serviceUsageDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useServiceUsageDispatch' must be used within a ServiceUsageProvider`
    );
  }
  return context;
};

const useServiceUsageUnit = () => {
  return [useServiceUsageState(), useServiceUsageDispatch()];
};

export {
  useServiceUsageDispatch,
  useServiceUsageState,
  useServiceUsageUnit,
  ServiceUsageProvider,
};
