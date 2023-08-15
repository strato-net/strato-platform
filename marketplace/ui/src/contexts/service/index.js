import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const ServiceStateContext = createContext();
const ServiceDispatchContext = createContext();

const ServicesProvider = ({ children }) => {
  const initialState = {
    service: null,
    isCreateServiceSubmitting: false,
    services: [],
    isServicesLoading: false,
    inventoryServices: [],
    isInventoryServicesLoading: false,
    itemServices: [],
    isItemServicesLoading: false,
    serviceDetails: null,
    isserviceDetailsLoading: false,
    certifyServices: [],
    isCertifyServicesLoading: false,
    serviceUpdateObject: null,
    isserviceUpdating: false,
    servicesAudit: [],
    isservicesAuditLoading: false,
    error: undefined,
    success: false,
    message: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <ServiceStateContext.Provider value={state}>
      <ServiceDispatchContext.Provider value={dispatch}>
        {children}
      </ServiceDispatchContext.Provider>
    </ServiceStateContext.Provider>
  );
};

const useServiceState = () => {
  const context = useContext(ServiceStateContext);
  if (context === undefined) {
    throw new Error(
      `'useServiceState' must be used within a ServicesProvider`
    );
  }
  return context;
};

const useServiceDispatch = () => {
  const context = useContext(ServiceDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useServiceDispatch' must be used within a ServicesProvider`
    );
  }
  return context;
};

const useServiceUnit = () => {
  return [useServiceState(), useServiceDispatch()];
};

export {
  useServiceDispatch,
  useServiceState,
  useServiceUnit,
  ServicesProvider,
};
