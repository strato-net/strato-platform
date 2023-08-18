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
      console.log('action.payload', action.payload)
      return {
        ...state,
        services: action.payload,
        totalServices: action.payload.total,
        isServicesLoading: false
      };
    case actionDescriptors.fetchServiceFailed:
      return {
        ...state,
        error: action.error,
        isServicesLoading: false
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
    case actionDescriptors.transferServiceOwnership:
      return {
        ...state,
        isOwnershipserviceTransferring: true
      };
    case actionDescriptors.transferServiceOwnershipSuccessful:
      return {
        ...state,
        serviceOwnership: action.payload,
        isOwnershipserviceTransferring: false
      };
    case actionDescriptors.transferServiceOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isOwnershipserviceTransferring: false
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
    case actionDescriptors.importAssetRequest:
      return {
        ...state,
        isAssetImportInProgress: true,
        assetsUploaded: 0,
        assetsUploadedErrors: []
      }
    case actionDescriptors.importAssetSuccess:
      return {
        ...state,
        isAssetImportInProgress: false,
        error: null
      }
    case actionDescriptors.importAssetFailure:
      return {
        ...state,
        error: action.error,
        isAssetImportInProgress: false,
        isImportAssetsModalOpen: true
      }
    case actionDescriptors.updateAssetImportCount:
      return {
        ...state,
        assetsUploaded: action.count
      }
    case actionDescriptors.updateAssetUploadError:
      return {
        ...state,
        assetsUploadedErrors: action.errors
      }
    case actionDescriptors.openImportCSVModal:
      return {
        ...state,
        isImportAssetsModalOpen: true
      }
    case actionDescriptors.closeImportCSVModal:
      return {
        ...state,
        isImportAssetsModalOpen: false
      }
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
