import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {

    case actionDescriptors.createServicesUsage:
      return {
        ...state,
        isCreateServiceUsageSubmitting: true
      };
    case actionDescriptors.createServiceUsageSuccessful:
      return {
        ...state,
        isCreateServiceUsageSubmitting: false
      };
    case actionDescriptors.createServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isCreateServiceUsageSubmitting: false
      };

    // Create Booked services
    case actionDescriptors.createBookedServiceUsage:
      return {
        ...state,
        isCreateServiceUsageSubmitting: true
      };
    case actionDescriptors.createBookedServiceUsageSuccessful:
      return {
        ...state,
        isCreateServiceUsageSubmitting: false
      };
    case actionDescriptors.createBookedServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isCreateServiceUsageSubmitting: false
      };

    // Create Provided services
    case actionDescriptors.createProvidedServiceUsage:
      return {
        ...state,
        isCreateServiceUsageSubmitting: true
      };
    case actionDescriptors.createProvidedServiceUsageSuccessful:
      return {
        ...state,
        isCreateServiceUsageSubmitting: false
      };
    case actionDescriptors.createProvidedServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isCreateServiceUsageSubmitting: false
      };

    // fetch all serviceUsage
    case actionDescriptors.fetchAllServicesUsage:
      return {
        ...state,
        isServicesUsageLoading: true
      };
    case actionDescriptors.fetchAllServiceUsageSuccessful:
      return {
        ...state,
        servicesUsage: action.payload,
        isServicesUsageLoading: false
      };
    case actionDescriptors.fetchAllServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isServicesUsageLoading: false
      };
    // fetch booked serviceUsage detail
    case actionDescriptors.fetchBookedServicesUsage:
      return {
        ...state,
        isServicesUsageLoading: true
      };
    case actionDescriptors.fetchBookedServiceUsageSuccessful:
      return {
        ...state,
        servicesUsage: action.payload,
        isServicesUsageLoading: false
      };
    case actionDescriptors.fetchBookedServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isServicesUsageLoading: false
      };
    // fetch provided serviceUsage detail
    case actionDescriptors.fetchProvidedServicesUsage:
      return {
        ...state,
        isServicesUsageLoading: true
      };
    case actionDescriptors.fetchProvidedServiceUsageSuccessful:
      return {
        ...state,
        servicesUsage: action.payload,
        isServicesUsageLoading: false
      };
    case actionDescriptors.fetchProvidedServiceUsageFailed:
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
    case actionDescriptors.updateServiceUsageSuccessful:
      return {
        ...state,
        servicesUsage: action.payload.servicesUsage,
        isUpdateServicesUsageLoading: false
      };
    case actionDescriptors.updateServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isUpdateServicesUsageLoading: false
      };

    // update Booked service usage
    case actionDescriptors.updateBookedServiceUsage:
      return {
        ...state,
        isUpdateServicesUsageLoading: true
      };
    case actionDescriptors.updateBookedServiceUsageSuccessful:
      return {
        ...state,
        servicesUsage: action.payload.servicesUsage,
        isUpdateServicesUsageLoading: false
      };
    case actionDescriptors.updateBookedServiceUsageFailed:
      return {
        ...state,
        error: action.error,
        isUpdateServicesUsageLoading: false
      };

    // update Provided service usage
    case actionDescriptors.updateProvidedServiceUsage:
      return {
        ...state,
        isUpdateServicesUsageLoading: true
      };
    case actionDescriptors.updateProvidedServiceUsageSuccessful:
      return {
        ...state,
        servicesUsage: action.payload.servicesUsage,
        isUpdateServicesUsageLoading: false
      };
    case actionDescriptors.updateProvidedServiceUsageFailed:
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
    case actionDescriptors.resetState:
      return {
        ...state,
        servicesUsage:[]
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
