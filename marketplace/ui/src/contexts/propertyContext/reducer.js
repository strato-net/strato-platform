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
        properties: [],
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
        message: action.error
      };
    case actionDescriptors.fetchPropertyDetails:
      return {
        ...state,
        isPropertyDetailsLoading: true,
      };
    case actionDescriptors.fetchPropertyDetailsSuccessful:
      return {
        ...state,
        isPropertyDetailsLoading: false,
        propertyDetails: action.payload
      };
    case actionDescriptors.fetchPropertyDetailsFailed:
      return {
        ...state,
        isPropertyDetailsLoading: false,
        propertyDetails: action.payload
      };
    // review cases:-
    case actionDescriptors.addReview:
      return {
        ...state,
        isReviewAdding: true,
      };
    case actionDescriptors.addReviewSuccessful:
      return {
        ...state,
        review: action.payload,
        isReviewAdding: false,
      };
    case actionDescriptors.addReviewFailed:
      return {
        ...state,
        error: action.error,
        isReviewAdding: false,
      };
    case actionDescriptors.updateReview:
      return {
        ...state,
        isReviewUpdating: true,
      };
    case actionDescriptors.updateReviewSuccessful:
      return {
        ...state,
        review: action.payload,
        isReviewUpdating: false,
      };
    case actionDescriptors.updateReviewfailed:
      return {
        ...state,
        error: action.error,
        isReviewUpdating: false,
      };
    case actionDescriptors.deleteReview:
      return {
        ...state,
        isReviewDeleting: true,
      };
    case actionDescriptors.deleteReviewSuccessful:
      return {
        ...state,
        review: action.payload,
        isReviewDeleting: false,
      };
    case actionDescriptors.deleteReviewFailed:
      return {
        ...state,
        error: action.error,
        isReviewDeleting: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
}

export default reducer;