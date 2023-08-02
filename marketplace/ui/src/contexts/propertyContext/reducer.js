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
        isPropertiesLoading: true,
      };
    case actionDescriptors.fetchPropertiesSuccessful:
      return {
        ...state,
        isPropertiesLoading: false,
        properties: action.payload
      };
    case actionDescriptors.fetchPropertiesFailed:
      return {
        ...state,
        isPropertiesLoading: false,
        properties: action.error
      };
    case actionDescriptors.fetchPropertyDetails:
      return {
        ...state,
        isPropertyDetailsLoading: true,
      };
    case actionDescriptors.fetchPropertyDetailsSuccessful:
      return {
        ...state,
        isPropertyDetailsLoading: true,
        propertyDetails: action.payload
      };
    case actionDescriptors.fetchPropertyDetailsFailed:
      return {
        ...state,
        isPropertyDetailsLoading: false,
        propertyDetails: action.payload
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
}

export default reducer;