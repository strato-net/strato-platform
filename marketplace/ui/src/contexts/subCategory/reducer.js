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
    case actionDescriptors.createSubCategory:
      return {
        ...state,
        isCreateSubCategorySubmitting: true
      };
    case actionDescriptors.createSubCategorySuccessful:
      return {
        ...state,
        subCategory: action.payload,
        isCreateSubCategorySubmitting: false
      };
    case actionDescriptors.createSubCategoryFailed:
      return {
        ...state,
        error: action.error,
        isCreateSubCategorySubmitting: false
      };
    case actionDescriptors.fetchSubCategory:
      return {
        ...state,
        issubCategorysLoading: true
      };
    case actionDescriptors.fetchSubCategorySuccessful:
      return {
        ...state,
        subCategorys: action.payload,
        issubCategorysLoading: false
      };
    case actionDescriptors.fetchSubCategoryFailed:
      return {
        ...state,
        error: action.error,
        issubCategorysLoading: false
      };
    case actionDescriptors.fetchSubCategoryDetails:
      return {
        ...state,
        issubCategoryDetailsLoading: true
      };
    case actionDescriptors.fetchSubCategoryDetailsSuccessful:
      return {
        ...state,
        subCategoryDetails: action.payload,
        issubCategoryDetailsLoading: false
      };
    case actionDescriptors.fetchSubCategoryDetailsFailed:
      return {
        ...state,
        error: action.error,
        issubCategoryDetailsLoading: false
      };
    case actionDescriptors.transferSubCategoryOwnership:
      return {
        ...state,
        isOwnershipsubCategoryTransferring: true
      };
    case actionDescriptors.transferSubCategoryOwnershipSuccessful:
      return {
        ...state,
        subCategoryOwnership: action.payload,
        isOwnershipsubCategoryTransferring: false
      };
    case actionDescriptors.transferSubCategoryOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isOwnershipsubCategoryTransferring: false
      };
    case actionDescriptors.updateSubCategory:
      return {
        ...state,
        issubCategoryUpdating: true
      };
    case actionDescriptors.updateSubCategorySuccessful:
      return {
        ...state,
        subCategoryUpdateObject: action.payload,
        issubCategoryUpdating: false
      };
    case actionDescriptors.updateSubCategoryFailed:
      return {
        ...state,
        error: action.error,
        issubCategoryUpdating: false
      };
    case actionDescriptors.fetchSubCategoryAudit:
      return {
        ...state,
        issubCategorysAuditLoading: true
      };
    case actionDescriptors.fetchSubCategoryAuditSuccessful:
      return {
        ...state,
        subCategorysAudit: action.payload,
        issubCategorysAuditLoading: false
      };
    case actionDescriptors.fetchSubCategoryAuditFailed:
      return {
        ...state,
        error: action.error,
        issubCategorysAuditLoading: false
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
