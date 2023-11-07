import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.resetMessage:
      return {
        ...state,
        success: false,
        message: null
      };
    case actionDescriptors.setMessage:
      return {
        ...state,
        success: action.success,
        message: action.message
      };
    case actionDescriptors.createSubCategory:
      return {
        ...state,
        isCreateSubCategorySubmitting: true
      };
    case actionDescriptors.createSubCategorySuccessful:
      return {
        ...state,
        subCategory: action.payload,
        isCreateSubCategorySubmitting: false
      };
    case actionDescriptors.createSubCategoryFailed:
      return {
        ...state,
        error: action.error,
        isCreateSubCategorySubmitting: false
      };
    case actionDescriptors.fetchSubCategory:
      return {
        ...state,
        isSubCategorysLoading: true
      };
    case actionDescriptors.fetchSubCategorySuccessful:
      return {
        ...state,
        subCategorys: action.payload,
        isSubCategorysLoading: false
      };
    case actionDescriptors.fetchSubCategoryFailed:
      return {
        ...state,
        error: action.error,
        isSubCategorysLoading: false
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
