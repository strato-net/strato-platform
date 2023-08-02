import { actionDescriptors } from "./actions";

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
    case actionDescriptors.createProperty:
      return {
        ...state,
        isCreatePropertySubmitting: true,
      };
    case actionDescriptors.createPropertySuccessful:
      return {
        ...state,
        product: action.payload,
        isCreatePropertySubmitting: false,
      };
    case actionDescriptors.createPropertyFailed:
      return {
        ...state,
        error: action.error,
        isCreatePropertySubmitting: false,
      };
    case actionDescriptors.fetchProperties:
      return {
        ...state,
        isProductsLoading: true,
      };
    case actionDescriptors.fetchPropertyDetails:
      return {
        ...state,
        isProductsLoading: true,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
}

export default reducer;