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
    case actionDescriptors.createEvent:
      return {
        ...state,
        isCreateEventSubmitting: true
      };
    case actionDescriptors.createEventSuccessful:
      return {
        ...state,
        event: action.payload,
        isCreateEventSubmitting: false
      };
    case actionDescriptors.createEventFailed:
      return {
        ...state,
        error: action.error,
        isCreateEventSubmitting: false
      };
    case actionDescriptors.fetchEvent:
      return {
        ...state,
        isEventsLoading: true
      };
    case actionDescriptors.fetchEventSuccessful:
      return {
        ...state,
        events: action.payload,
        isEventsLoading: false
      };
    case actionDescriptors.fetchEventFailed:
      return {
        ...state,
        error: action.error,
        isEventsLoading: false
      };
  case actionDescriptors.fetchCertifyEvent:
    return {
      ...state,
      isCertifyEventsLoading: true
    };
  case actionDescriptors.fetchCertifyEventSuccessful:
    return {
      ...state,
      certifyEvents: action.payload,
      isCertifyEventsLoading: false
    };
  case actionDescriptors.fetchCertifyEventFailed:
    return {
      ...state,
      error: action.error,
      isCertifyEventsLoading: false
    };
  case actionDescriptors.fetchEventOfInventory:
    return {
      ...state,
      isInventoryEventsLoading: true
    };
  case actionDescriptors.fetchEventOfInventorySuccessful:
    return {
      ...state,
      inventoryEvents: action.payload,
      isInventoryEventsLoading: false
    };
  case actionDescriptors.fetchEventOfInventoryFailed:
    return {
      ...state,
      error: action.error,
      isInventoryEventsLoading: false
    };
    case actionDescriptors.fetchEventOfItem:
      return {
        ...state,
        isItemEventsLoading: true
      };
    case actionDescriptors.fetchEventOfItemSuccessful:
      return {
        ...state,
        itemEvents: action.payload,
        isItemEventsLoading: false
      };
    case actionDescriptors.fetchEventOfItemFailed:
      return {
        ...state,
        error: action.error,
        isItemEventsLoading: false
      };   
    case actionDescriptors.fetchEventDetails:
      return {
        ...state,
        iseventDetailsLoading: true
      };
    case actionDescriptors.fetchEventDetailsSuccessful:
      return {
        ...state,
        eventDetails: action.payload,
        iseventDetailsLoading: false
      };
    case actionDescriptors.fetchEventDetailsFailed:
      return {
        ...state,
        error: action.error,
        iseventDetailsLoading: false
      };
    case actionDescriptors.transferEventOwnership:
      return {
        ...state,
        isOwnershipeventTransferring: true
      };
    case actionDescriptors.transferEventOwnershipSuccessful:
      return {
        ...state,
        eventOwnership: action.payload,
        isOwnershipeventTransferring: false
      };
    case actionDescriptors.transferEventOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isOwnershipeventTransferring: false
      };
    case actionDescriptors.updateEvent:
      return {
        ...state,
        iseventUpdating: true
      };
    case actionDescriptors.updateEventSuccessful:
      return {
        ...state,
        eventUpdateObject: action.payload,
        iseventUpdating: false
      };
    case actionDescriptors.updateEventFailed:
      return {
        ...state,
        error: action.error,
        iseventUpdating: false
      };
    case actionDescriptors.fetchEventAudit:
      return {
        ...state,
        iseventsAuditLoading: true
      };
    case actionDescriptors.fetchEventAuditSuccessful:
      return {
        ...state,
        eventsAudit: action.payload,
        iseventsAuditLoading: false
      };
    case actionDescriptors.fetchEventAuditFailed:
      return {
        ...state,
        error: action.error,
        iseventsAuditLoading: false
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
