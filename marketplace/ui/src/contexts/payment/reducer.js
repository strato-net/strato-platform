import { actionDescriptors } from './actions';

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.getPaymentServices:
      return {
        ...state,
        arePaymentServicesLoading: true,
      };
    case actionDescriptors.getPaymentServicesSuccessful:
      return {
        ...state,
        paymentServices: action.payload.data,
        paymentServicesTotal: action.payload.count,
        arePaymentServicesLoading: false,
      };
    case actionDescriptors.getPaymentServicesFailed:
      return {
        ...state,
        error: action.error,
        arePaymentServicesLoading: false,
      };
    case actionDescriptors.getNotOnboarded:
      return {
        ...state,
        areNotOnboardedLoading: true,
      };
    case actionDescriptors.getNotOnboardedSuccessful:
      return {
        ...state,
        notOnboarded: action.payload.data,
        notOnboardedTotal: action.payload.count,
        areNotOnboardedLoading: false,
      };
    case actionDescriptors.getNotOnboardedFailed:
      return {
        ...state,
        error: action.error,
        areNotOnboardedLoading: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
