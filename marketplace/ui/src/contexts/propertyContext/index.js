import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const PropertyStateContext = createContext();
const PropertyDispatchContext = createContext();

const PropertyProvider = ({ children }) => {
  const initialState = {
    property: null,
    isCreatePropertySubmitting: false,
    isUpdatePropertySubmitting: false,
    properties: [],
    filter: null,
    isPropertiesLoading: false,
    error: undefined,
    success: false,
    message: null,
    propertyDetails: null,
    isPropertyDetailsLoading: false,
    isReviewAdding: false,
    isReviewUpdating: false,
    isReviewDeleting: false,
    review: [],
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <PropertyStateContext.Provider value={state}>
      <PropertyDispatchContext.Provider value={dispatch}>
        {children}
      </PropertyDispatchContext.Provider>
    </PropertyStateContext.Provider>
  );
};

const usePropertiesState = () => {
  const context = useContext(PropertyStateContext);
  if (context === undefined) {
    throw new Error(
      `'usePropertiesState' must be used within a PropertyProvider`
    );
  }
  return context;
};

const usePropertiesDispatch = () => {
  const context = useContext(PropertyDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'usePropertiesDispatch' must be used within a PropertyProvider`
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
  PropertyProvider,
};
