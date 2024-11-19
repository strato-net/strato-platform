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
    case actionDescriptors.fetchRedemptionServices:
      return {
        ...state,
        isFetchingRedemptionServices: true,
      };
    case actionDescriptors.fetchRedemptionServicesSuccessful:
      return {
        ...state,
        redemptionServices: action.payload,
        isFetchingRedemptionServices: false,
      };
    case actionDescriptors.fetchRedemptionServicesFailed:
      return {
        ...state,
        error: action.error,
        isFetchingRedemptionServices: false,
      };
    case actionDescriptors.requestRedemption:
      return {
        ...state,
        isRequestingRedemption: true,
      };
    case actionDescriptors.requestRedemptionSuccessful:
      return {
        ...state,
        redemption: action.payload,
        isRequestingRedemption: false,
      };
    case actionDescriptors.requestRedemptionFailed:
      return {
        ...state,
        error: action.error,
        isRequestingRedemption: false,
      };
    case actionDescriptors.fetchOutgoingRedemptionRequests:
      return {
        ...state,
        isFetchingOutgoingRedemptions: true,
      };
    case actionDescriptors.fetchOutgoingRedemptionRequestsSuccessful:
      return {
        ...state,
        outgoingRedemptions: action.payload,
        isFetchingOutgoingRedemptions: false,
      };
    case actionDescriptors.fetchOutgoingRedemptionRequestsFailed:
      return {
        ...state,
        error: action.error,
        isFetchingOutgoingRedemptions: false,
      };
    case actionDescriptors.fetchIncomingRedemptionRequests:
      return {
        ...state,
        isFetchingIncomingRedemptions: true,
      };
    case actionDescriptors.fetchIncomingRedemptionRequestsSuccessful:
      return {
        ...state,
        incomingRedemptions: action.payload,
        isFetchingIncomingRedemptions: false,
      };
    case actionDescriptors.fetchIncomingRedemptionRequestsFailed:
      return {
        ...state,
        error: action.error,
        isFetchingIncomingRedemptions: false,
      };
    case actionDescriptors.fetchRedemptionDetails:
      return {
        ...state,
        isFetchingRedemptionDetails: true,
      };
    case actionDescriptors.fetchRedemptionDetailsSuccessful:
      return {
        ...state,
        redemption: action.payload,
        isFetchingRedemptionDetails: false,
      };
    case actionDescriptors.fetchRedemptionDetailsFailed:
      return {
        ...state,
        error: action.error,
        isFetchingRedemptionDetails: false,
      };
    case actionDescriptors.closeRedemption:
      return {
        ...state,
        isClosingRedemption: true,
      };
    case actionDescriptors.closeRedemptionSuccessful:
      return {
        ...state,
        isClosingRedemption: false,
      };
    case actionDescriptors.closeRedemptionFailed:
      return {
        ...state,
        error: action.error,
        isClosingRedemption: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
