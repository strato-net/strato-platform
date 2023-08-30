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
    case actionDescriptors.createVintage:
      return {
        ...state,
        isCreateVintageSubmitting: true,
      };
    case actionDescriptors.createVintageSuccessful:
      return {
        ...state,
        vintage: action.payload,
        isCreateVintageSubmitting: false,
      };
    case actionDescriptors.createVintageFailed:
      return {
        ...state,
        error: action.error,
        isCreateVintageSubmitting: false,
      };
    case actionDescriptors.fetchVintages:
      return {
        ...state,
        vintages: [],
        isVintagesLoading: true,
      };
    case actionDescriptors.fetchVintagesSuccessful:
      return {
        ...state,
        isVintagesLoading: false,
        vintages: action.payload
      };
    case actionDescriptors.fetchVintagesFailed:
      return {
        ...state,
        isVintagesLoading: false,
        message: action.error
      };
    case actionDescriptors.fetchVintageDetails:
      return {
        ...state,
        isVintageDetailsLoading: true,
      };
    case actionDescriptors.fetchVintageDetailsSuccessful:
      return {
        ...state,
        isVintageDetailsLoading: false,
        vintageDetails: action.payload
      };
    case actionDescriptors.fetchVintageDetailsFailed:
      return {
        ...state,
        isVintageDetailsLoading: false,
        vintageDetails: action.payload
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
}

export default reducer;