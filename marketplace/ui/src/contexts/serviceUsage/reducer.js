import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {
    // fetch all serviceUsage
    case actionDescriptors.fetchAllServicesUsage:
      return {
        ...state,
        isServicesUsageLoading: true
      };
    case actionDescriptors.fetchAllServiceUsageSuccessful:
      return {
        ...state,
        servicesUsage: action.payload.servicesUsage,
        isServicesUsageLoading: false
      };
    case actionDescriptors.fetchAllServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isServicesUsageLoading: false
      };
    // fetch serviceUsage detail
    case actionDescriptors.fetchServicesUsage:
      return {
        ...state,
        isServiceUsageDetailLoading: true
      };
    case actionDescriptors.fetchServiceUsageSuccessful:
      return {
        ...state,
        servicesUsage: action.payload.servicesUsage,
        isServiceUsageDetailLoading: false
      };
    case actionDescriptors.fetchServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isServiceUsageDetailLoading: false
      };
    // update serviceUsage
    case actionDescriptors.updateServiceUsage:
      return {
        ...state,
        isUpdateServicesUsageLoading: true
      };
    case actionDescriptors.UpdateServiceUsageSuccessful:
      return {
        ...state,
        servicesUsage: action.payload.servicesUsage,
        isUpdateServicesUsageLoading: false
      };
    case actionDescriptors.UpdateServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isUpdateServicesUsageLoading: false
      };

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
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
