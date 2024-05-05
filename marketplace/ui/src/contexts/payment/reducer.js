import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.getPaymentServices:
      return {
        ...state,
        arePaymentServicesLoading: true
      };
    case actionDescriptors.getPaymentServicesSuccessful:
      return {
        ...state,
        paymentServices: action.payload.data,
        paymentServicesTotal: action.payload.count,
        arePaymentServicesLoading: false
      };
    case actionDescriptors.getPaymentServicesFailed:
      return {
        ...state,
        error: action.error,
        arePaymentServicesLoading: false
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
