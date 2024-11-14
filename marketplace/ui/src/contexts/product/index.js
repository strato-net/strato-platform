import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';

const ProductStateContext = createContext();
const ProductDispatchContext = createContext();

const ProductsProvider = ({ children }) => {
  const initialState = {
    product: null,
    isCreateProductSubmitting: false,
    products: [],
    productsTotal: 10,
    isProductsLoading: false,
    isProductsForFilterLoading: false,
    productsForFilter: [],
    categoryBasedProducts: [],
    isCategoryBasedProductsLoading: false,
    productDetails: null,
    isproductDetailsLoading: false,
    isProductDeleting: false,
    productDeleteObject: null,
    uploadedImg: null,
    isuploadImageSubmitting: false,
    deletedImg: null,
    isdeletedImageSubmitting: false,
    isupdateImageSubmitting: false,
    updatedImg: null,
    productUpdateObject: null,
    isproductUpdating: false,
    error: undefined,
    success: false,
    message: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <ProductStateContext.Provider value={state}>
      <ProductDispatchContext.Provider value={dispatch}>
        {children}
      </ProductDispatchContext.Provider>
    </ProductStateContext.Provider>
  );
};

const useProductState = () => {
  const context = useContext(ProductStateContext);
  if (context === undefined) {
    throw new Error(`'useProductState' must be used within a ProductsProvider`);
  }
  return context;
};

const useProductDispatch = () => {
  const context = useContext(ProductDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useProductDispatch' must be used within a ProductsProvider`
    );
  }
  return context;
};

const useProductUnit = () => {
  return [useProductState(), useProductDispatch()];
};

export {
  useProductDispatch,
  useProductState,
  useProductUnit,
  ProductsProvider,
};
