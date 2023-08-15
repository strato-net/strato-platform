import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {
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
    case actionDescriptors.createService:
      return {
        ...state,
        isCreateServiceSubmitting: true
      };
    case actionDescriptors.createServiceSuccessful:
      return {
        ...state,
        service: action.payload,
        isCreateServiceSubmitting: false
      };
    case actionDescriptors.createServiceFailed:
      return {
        ...state,
        error: action.error,
        isCreateServiceSubmitting: false
      };
    case actionDescriptors.fetchService:
      return {
        ...state,
        isServicesLoading: true
      };
    case actionDescriptors.fetchServiceSuccessful:
      return {
        ...state,
        services: action.payload,
        isServicesLoading: false
      };
    case actionDescriptors.fetchServiceFailed:
      return {
        ...state,
        error: action.error,
        isServicesLoading: false
      };
  case actionDescriptors.fetchCertifyService:
    return {
      ...state,
      isCertifyServicesLoading: true
    };
  case actionDescriptors.fetchCertifyServiceSuccessful:
    return {
      ...state,
      certifyServices: action.payload,
      isCertifyServicesLoading: false
    };
  case actionDescriptors.fetchCertifyServiceFailed:
    return {
      ...state,
      error: action.error,
      isCertifyServicesLoading: false
    };
  case actionDescriptors.fetchServiceOfInventory:
    return {
      ...state,
      isInventoryServicesLoading: true
    };
  case actionDescriptors.fetchServiceOfInventorySuccessful:
    return {
      ...state,
      inventoryServices: action.payload,
      isInventoryServicesLoading: false
    };
  case actionDescriptors.fetchServiceOfInventoryFailed:
    return {
      ...state,
      error: action.error,
      isInventoryServicesLoading: false
    };
    case actionDescriptors.fetchServiceOfItem:
      return {
        ...state,
        isItemServicesLoading: true
      };
    case actionDescriptors.fetchServiceOfItemSuccessful:
      return {
        ...state,
        itemServices: action.payload,
        isItemServicesLoading: false
      };
    case actionDescriptors.fetchServiceOfItemFailed:
      return {
        ...state,
        error: action.error,
        isItemServicesLoading: false
      };   
    case actionDescriptors.fetchServiceDetails:
      return {
        ...state,
        isserviceDetailsLoading: true
      };
    case actionDescriptors.fetchServiceDetailsSuccessful:
      return {
        ...state,
        serviceDetails: action.payload,
        isserviceDetailsLoading: false
      };
    case actionDescriptors.fetchServiceDetailsFailed:
      return {
        ...state,
        error: action.error,
        isserviceDetailsLoading: false
      };
    case actionDescriptors.updateService:
      return {
        ...state,
        isserviceUpdating: true
      };
    case actionDescriptors.updateServiceSuccessful:
      return {
        ...state,
        serviceUpdateObject: action.payload,
        isserviceUpdating: false
      };
    case actionDescriptors.updateServiceFailed:
      return {
        ...state,
        error: action.error,
        isserviceUpdating: false
      };
    case actionDescriptors.fetchServiceAudit:
      return {
        ...state,
        isservicesAuditLoading: true
      };
    case actionDescriptors.fetchServiceAuditSuccessful:
      return {
        ...state,
        servicesAudit: action.payload,
        isservicesAuditLoading: false
      };
    case actionDescriptors.fetchServiceAuditFailed:
      return {
        ...state,
        error: action.error,
        isservicesAuditLoading: false
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
