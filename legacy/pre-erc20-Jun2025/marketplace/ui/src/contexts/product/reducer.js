import { actionDescriptors } from './actions';

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.resetMessage:
      return {
        ...state,
        success: false,
        message: null,
      };
    case actionDescriptors.setMessage:
      return {
        ...state,
        success: action.success,
        message: action.message,
      };
    case actionDescriptors.createProduct:
      return {
        ...state,
        isCreateProductSubmitting: true,
      };
    case actionDescriptors.createProductSuccessful:
      return {
        ...state,
        product: action.payload,
        isCreateProductSubmitting: false,
      };
    case actionDescriptors.createProductFailed:
      return {
        ...state,
        error: action.error,
        isCreateProductSubmitting: false,
      };
    case actionDescriptors.fetchProduct:
      return {
        ...state,
        isProductsLoading: true,
      };
    case actionDescriptors.fetchProductSuccessful:
      return {
        ...state,
        products: action.payload.data,
        productsTotal: action.payload.count,
        isProductsLoading: false,
      };
    case actionDescriptors.fetchProductFailed:
      return {
        ...state,
        error: action.error,
        isProductsLoading: false,
      };

    case actionDescriptors.fetchCategoryBasedProduct:
      return {
        ...state,
        isCategoryBasedProductsLoading: true,
      };
    case actionDescriptors.fetchCategoryBasedProductSuccessful:
      return {
        ...state,
        categoryBasedProducts: action.payload,
        isCategoryBasedProductsLoading: false,
      };
    case actionDescriptors.fetchCategoryBasedProductFailed:
      return {
        ...state,
        error: action.error,
        isCategoryBasedProductsLoading: false,
      };

    case actionDescriptors.fetchProductDetails:
      return {
        ...state,
        isproductDetailsLoading: true,
      };
    case actionDescriptors.fetchProductDetailsSuccessful:
      return {
        ...state,
        productDetails: action.payload,
        isproductDetailsLoading: false,
      };
    case actionDescriptors.fetchProductDetailsFailed:
      return {
        ...state,
        error: action.error,
        isproductDetailsLoading: false,
      };

    case actionDescriptors.uploadImage:
      return {
        ...state,
        isuploadImageSubmitting: true,
      };
    case actionDescriptors.uploadImageSuccessful:
      return {
        ...state,
        uploadedImg: action.payload,
        isuploadImageSubmitting: false,
      };
    case actionDescriptors.uploadImageFailed:
      return {
        ...state,
        error: action.error,
        isuploadImageSubmitting: false,
      };

    case actionDescriptors.updateImage:
      return {
        ...state,
        isupdateImageSubmitting: true,
      };
    case actionDescriptors.updateImageSuccessful:
      return {
        ...state,
        updatedImg: action.payload,
        isupdateImageSubmitting: false,
      };
    case actionDescriptors.updateImageFailed:
      return {
        ...state,
        error: action.error,
        isupdateImageSubmitting: false,
      };
    case actionDescriptors.updateProduct:
      return {
        ...state,
        isproductUpdating: true,
      };
    case actionDescriptors.updateProductSuccessful:
      return {
        ...state,
        productUpdateObject: action.payload,
        isproductUpdating: false,
      };
    case actionDescriptors.updateProductFailed:
      return {
        ...state,
        error: action.error,
        isproductUpdating: false,
      };

    case actionDescriptors.deleteProduct:
      return {
        ...state,
        isProductDeleting: true,
      };
    case actionDescriptors.deleteProductSuccessful:
      return {
        ...state,
        productDeleteObject: action.payload,
        isProductDeleting: false,
      };
    case actionDescriptors.deleteProductFailed:
      return {
        ...state,
        error: action.error,
        isProductDeleting: false,
      };
    case actionDescriptors.deleteProductConflict:
      return {
        ...state,
        isProductDeleting: false,
      };

    case actionDescriptors.fetchProductsForFilter:
      return {
        ...state,
        isProductsForFilterLoading: true,
      };
    case actionDescriptors.fetchProductsForFilterSuccessful:
      return {
        ...state,
        productsForFilter: action.payload,
        isProductsForFilterLoading: false,
      };
    case actionDescriptors.fetchProductsForFilterFailed:
      return {
        ...state,
        error: action.error,
        isProductsForFilterLoading: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
