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
    case actionDescriptors.createMembershipService:
      return {
        ...state,
        isCreateMembershipServiceSubmitting: true
      };
    case actionDescriptors.createMembershipServiceSuccessful:
      return {
        ...state,
        membershipService: action.payload,
        isCreateMembershipServiceSubmitting: false
      };
    case actionDescriptors.createMembershipServiceFailed:
      return {
        ...state,
        error: action.error,
        isCreateMembershipServiceSubmitting: false
      };
    case actionDescriptors.fetchMembershipService:
      return {
        ...state,
        isMembershipServicesLoading: true
      };
    case actionDescriptors.fetchMembershipServiceSuccessful:
      return {
        ...state,
        membershipServices: action.payload.membershipServices,
        totalMembershipServices: action.payload.total,
        isMembershipServicesLoading: false
      };
    case actionDescriptors.fetchMembershipServiceFailed:
      return {
        ...state,
        error: action.error,
        isMembershipServicesLoading: false
      };
    case actionDescriptors.fetchMembershipServiceDetails:
      return {
        ...state,
        ismembershipServiceDetailsLoading: true
      };
    case actionDescriptors.fetchMembershipServiceDetailsSuccessful:
      return {
        ...state,
        membershipServiceDetails: action.payload,
        ismembershipServiceDetailsLoading: false
      };
    case actionDescriptors.fetchMembershipServiceDetailsFailed:
      return {
        ...state,
        error: action.error,
        ismembershipServiceDetailsLoading: false
      };
    case actionDescriptors.transferMembershipServiceOwnership:
      return {
        ...state,
        isOwnershipmembershipServiceTransferring: true
      };
    case actionDescriptors.transferMembershipServiceOwnershipSuccessful:
      return {
        ...state,
        membershipServiceOwnership: action.payload,
        isOwnershipmembershipServiceTransferring: false
      };
    case actionDescriptors.transferMembershipServiceOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isOwnershipmembershipServiceTransferring: false
      };
    case actionDescriptors.updateMembershipService:
      return {
        ...state,
        ismembershipServiceUpdating: true
      };
    case actionDescriptors.updateMembershipServiceSuccessful:
      return {
        ...state,
        membershipServiceUpdateObject: action.payload,
        ismembershipServiceUpdating: false
      };
    case actionDescriptors.updateMembershipServiceFailed:
      return {
        ...state,
        error: action.error,
        ismembershipServiceUpdating: false
      };
    case actionDescriptors.fetchMembershipServiceAudit:
      return {
        ...state,
        ismembershipServicesAuditLoading: true
      };
    case actionDescriptors.fetchMembershipServiceAuditSuccessful:
      return {
        ...state,
        membershipServicesAudit: action.payload,
        ismembershipServicesAuditLoading: false
      };
    case actionDescriptors.fetchMembershipServiceAuditFailed:
      return {
        ...state,
        error: action.error,
        ismembershipServicesAuditLoading: false
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
