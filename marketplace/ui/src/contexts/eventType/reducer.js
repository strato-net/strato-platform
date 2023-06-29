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
    case actionDescriptors.createEventType:
      return {
        ...state,
        isCreateEventTypeSubmitting: true
      };
    case actionDescriptors.createEventTypeSuccessful:
      return {
        ...state,
        eventType: action.payload,
        isCreateEventTypeSubmitting: false
      };
    case actionDescriptors.createEventTypeFailed:
      return {
        ...state,
        error: action.error,
        isCreateEventTypeSubmitting: false
      };
    case actionDescriptors.fetchEventType:
      return {
        ...state,
        isEventTypesLoading: true
      };
    case actionDescriptors.fetchEventTypeSuccessful:
      return {
        ...state,
        eventTypes: action.payload,
        isEventTypesLoading: false
      };
    case actionDescriptors.fetchEventTypeFailed:
      return {
        ...state,
        error: action.error,
        isEventTypesLoading: false
      };
    case actionDescriptors.fetchEventTypeDetails:
      return {
        ...state,
        iseventTypeDetailsLoading: true
      };
    case actionDescriptors.fetchEventTypeDetailsSuccessful:
      return {
        ...state,
        eventTypeDetails: action.payload,
        iseventTypeDetailsLoading: false
      };
    case actionDescriptors.fetchEventTypeDetailsFailed:
      return {
        ...state,
        error: action.error,
        iseventTypeDetailsLoading: false
      };
    case actionDescriptors.transferEventTypeOwnership:
      return {
        ...state,
        isOwnershipeventTypeTransferring: true
      };
    case actionDescriptors.transferEventTypeOwnershipSuccessful:
      return {
        ...state,
        eventTypeOwnership: action.payload,
        isOwnershipeventTypeTransferring: false
      };
    case actionDescriptors.transferEventTypeOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isOwnershipeventTypeTransferring: false
      };
    case actionDescriptors.updateEventType:
      return {
        ...state,
        iseventTypeUpdating: true
      };
    case actionDescriptors.updateEventTypeSuccessful:
      return {
        ...state,
        eventTypeUpdateObject: action.payload,
        iseventTypeUpdating: false
      };
    case actionDescriptors.updateEventTypeFailed:
      return {
        ...state,
        error: action.error,
        iseventTypeUpdating: false
      };
    case actionDescriptors.fetchEventTypeAudit:
      return {
        ...state,
        iseventTypesAuditLoading: true
      };
    case actionDescriptors.fetchEventTypeAuditSuccessful:
      return {
        ...state,
        eventTypesAudit: action.payload,
        iseventTypesAuditLoading: false
      };
    case actionDescriptors.fetchEventTypeAuditFailed:
      return {
        ...state,
        error: action.error,
        iseventTypesAuditLoading: false
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
