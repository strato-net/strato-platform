import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const PropertiesStateContext = createContext();
const PropertiesDispatchContext = createContext();

const PropertiessProvider = ({ children }) => {
  const initialState = {
    property: null,
    isCreateProductSubmitting: false,
    properties: [],
    isPropertiesLoading: false,
    error: undefined,
    success: false,
    message: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <PropertiesStateContext.Provider value={state}>
      <PropertiesDispatchContext.Provider value={dispatch}>
        {children}
      </PropertiesDispatchContext.Provider>
    </PropertiesStateContext.Provider>
  );
};

const usePropertiesState = () => {
  const context = useContext(PropertiesStateContext);
  if (context === undefined) {
    throw new Error(
      `'usePropertiesState' must be used within a ProductsProvider`
    );
  }
  return context;
};

const usePropertiesDispatch = () => {
  const context = useContext(PropertiesDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'usePropertiesDispatch' must be used within a ProductsProvider`
    );
  }
  return context;
};

const usePropertiesUnit = () => {
  return [usePropertiesState(), usePropertiesDispatch()];
};

export {
  usePropertiesDispatch,
  usePropertiesState,
  usePropertiesUnit,
  PropertiessProvider,
};
