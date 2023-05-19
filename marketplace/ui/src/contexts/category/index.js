import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const CategoryStateContext = createContext();
const CategoryDispatchContext = createContext();

const CategorysProvider = ({ children }) => {
  const initialState = {
    category: null,
    isCreateCategorySubmitting: false,
    categorys: [],
    iscategorysLoading: false,
    // categoryDetails: null,
    // iscategoryDetailsLoading: false,
    // categoryOwnership: null,
    // isOwnershipcategoryTransferring: false,
    // categoryUpdateObject: null,
    // iscategoryUpdating: false,
    // categorysAudit: [],
    // iscategorysAuditLoading: false,
    error: undefined,
    success: false,
    message: null,
    // isAssetImportInProgress: false,
    // assetsUploaded: 0,
    // assetsUploadedErrors: [],
    // isImportAssetsModalOpen: false
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <CategoryStateContext.Provider value={state}>
      <CategoryDispatchContext.Provider value={dispatch}>
        {children}
      </CategoryDispatchContext.Provider>
    </CategoryStateContext.Provider>
  );
};

const useCategoryState = () => {
  const context = useContext(CategoryStateContext);
  if (context === undefined) {
    throw new Error(
      `'useCategoryState' must be used within a CategorysProvider`
    );
  }
  return context;
};

const useCategoryDispatch = () => {
  const context = useContext(CategoryDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useCategoryDispatch' must be used within a CategorysProvider`
    );
  }
  return context;
};

const useCategoryUnit = () => {
  return [useCategoryState(), useCategoryDispatch()];
};

export {
  useCategoryDispatch,
  useCategoryState,
  useCategoryUnit,
  CategorysProvider,
};
