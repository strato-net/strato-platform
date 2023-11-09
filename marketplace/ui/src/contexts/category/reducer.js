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
    case actionDescriptors.createCategory:
      return {
        ...state,
        isCreateCategorySubmitting: true
      };
    case actionDescriptors.createCategorySuccessful:
      return {
        ...state,
        category: action.payload,
        isCreateCategorySubmitting: false
      };
    case actionDescriptors.createCategoryFailed:
      return {
        ...state,
        error: action.error,
        isCreateCategorySubmitting: false
      };
    case actionDescriptors.fetchCategory:
      return {
        ...state,
        isCategorysLoading: true
      };
    case actionDescriptors.fetchCategorySuccessful:
      return {
        ...state,
        categorys: action.payload,
        isCategorysLoading: false
      };
    case actionDescriptors.fetchCategoryFailed:
      return {
        ...state,
        error: action.error,
        isCategorysLoading: false
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
