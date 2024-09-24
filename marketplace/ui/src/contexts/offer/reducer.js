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
      
    case actionDescriptors.createOffer:
      return {
        ...state,
        isCreateOfferSubmitting: true,
      };
      
    case actionDescriptors.createOfferSuccessful:
      return {
        ...state,
        offer: action.payload,
        isCreateOfferSubmitting: false,
      };
      
    case actionDescriptors.createOfferFailed:
      return {
        ...state,
        error: action.error,
        isCreateOfferSubmitting: false,
      };
      
    case actionDescriptors.fetchOffers:
      return {
        ...state,
        isOffersLoading: true,
      };
      
    case actionDescriptors.fetchOffersSuccessful:
      return {
        ...state,
        offers: action.payload,
        isOffersLoading: false,
      };
      
    case actionDescriptors.fetchOffersFailed:
      return {
        ...state,
        error: action.error,
        isOffersLoading: false,
      };
      
    case actionDescriptors.fetchOffer:
      return {
        ...state,
        isOffersLoading: true,
      };
      
    case actionDescriptors.fetchOfferSuccessful:
      return {
        ...state,
        offer: action.payload,
        isOffersLoading: false,
      };
      
    case actionDescriptors.fetchOfferFailed:
      return {
        ...state,
        error: action.error,
        isOffersLoading: false,
      };
      
    case actionDescriptors.updateOffer:
      return {
        ...state,
        isUpdateOfferSubmitting: true,
      };
      
    case actionDescriptors.updateOfferSuccessful:
      return {
        ...state,
        offer: action.payload,
        isUpdateOfferSubmitting: false,
      };
      
    case actionDescriptors.updateOfferFailed:
      return {
        ...state,
        error: action.error,
        isUpdateOfferSubmitting: false,
      };
      
    case actionDescriptors.acceptOffer:
      return {
        ...state,
        success: true,
        message: "Offer accepted successfully",
      };
      
    case actionDescriptors.rejectOffer:
      return {
        ...state,
        success: true,
        message: "Offer rejected successfully",
      };
      
    case actionDescriptors.cancelOffer:
      return {
        ...state,
        success: true,
        message: "Offer canceled successfully",
      };
      
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
