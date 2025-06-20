import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';

const SubCategoryStateContext = createContext();
const SubCategoryDispatchContext = createContext();

const SubCategorysProvider = ({ children }) => {
  const initialState = {
    subCategory: null,
    isCreateSubCategorySubmitting: false,
    subCategorys: [],
    issubCategorysLoading: false,
    error: undefined,
    success: false,
    message: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <SubCategoryStateContext.Provider value={state}>
      <SubCategoryDispatchContext.Provider value={dispatch}>
        {children}
      </SubCategoryDispatchContext.Provider>
    </SubCategoryStateContext.Provider>
  );
};

const useSubCategoryState = () => {
  const context = useContext(SubCategoryStateContext);
  if (context === undefined) {
    throw new Error(
      `'useSubCategoryState' must be used within a SubCategorysProvider`
    );
  }
  return context;
};

const useSubCategoryDispatch = () => {
  const context = useContext(SubCategoryDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useSubCategoryDispatch' must be used within a SubCategorysProvider`
    );
  }
  return context;
};

const useSubCategoryUnit = () => {
  return [useSubCategoryState(), useSubCategoryDispatch()];
};

export {
  useSubCategoryDispatch,
  useSubCategoryState,
  useSubCategoryUnit,
  SubCategorysProvider,
};
