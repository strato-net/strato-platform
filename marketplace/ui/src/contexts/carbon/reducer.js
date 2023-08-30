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
    case actionDescriptors.createCarbon:
      return {
        ...state,
        isCreateCarbonSubmitting: true,
      };
    case actionDescriptors.createCarbonSuccessful:
      return {
        ...state,
        carbon: action.payload,
        isCreateCarbonSubmitting: false,
      };
    case actionDescriptors.createCarbonFailed:
      return {
        ...state,
        error: action.error,
        isCreateCarbonSubmitting: false,
      };
    case actionDescriptors.fetchCarbons:
      return {
        ...state,
        carbons: [],
        isCarbonsLoading: true,
      };
    case actionDescriptors.fetchCarbonsSuccessful:
      return {
        ...state,
        isCarbonsLoading: false,
        carbons: action.payload
      };
    case actionDescriptors.fetchCarbonsFailed:
      return {
        ...state,
        isCarbonsLoading: false,
        message: action.error
      };
    case actionDescriptors.fetchCarbonDetails:
      return {
        ...state,
        isCarbonDetailsLoading: true,
      };
    case actionDescriptors.fetchCarbonDetailsSuccessful:
      return {
        ...state,
        isCarbonDetailsLoading: false,
        carbonDetails: action.payload
      };
    case actionDescriptors.fetchCarbonDetailsFailed:
      return {
        ...state,
        isCarbonDetailsLoading: false,
        carbonDetails: action.payload
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
}

export default reducer;