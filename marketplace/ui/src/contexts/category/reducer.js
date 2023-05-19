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
    case actionDescriptors.createCategory:
      return {
        ...state,
        isCreateCategorySubmitting: true
      };
    case actionDescriptors.createCategorySuccessful:
      return {
        ...state,
        category: action.payload,
        isCreateCategorySubmitting: false
      };
    case actionDescriptors.createCategoryFailed:
      return {
        ...state,
        error: action.error,
        isCreateCategorySubmitting: false
      };
    case actionDescriptors.fetchCategory:
      return {
        ...state,
        iscategorysLoading: true
      };
    case actionDescriptors.fetchCategorySuccessful:
      return {
        ...state,
        categorys: action.payload,
        iscategorysLoading: false
      };
    case actionDescriptors.fetchCategoryFailed:
      return {
        ...state,
        error: action.error,
        iscategorysLoading: false
      };
    // case actionDescriptors.fetchCategoryDetails:
    //   return {
    //     ...state,
    //     iscategoryDetailsLoading: true
    //   };
    // case actionDescriptors.fetchCategoryDetailsSuccessful:
    //   return {
    //     ...state,
    //     categoryDetails: action.payload,
    //     iscategoryDetailsLoading: false
    //   };
    // case actionDescriptors.fetchCategoryDetailsFailed:
    //   return {
    //     ...state,
    //     error: action.error,
    //     iscategoryDetailsLoading: false
    //   };
    // case actionDescriptors.transferCategoryOwnership:
    //   return {
    //     ...state,
    //     isOwnershipcategoryTransferring: true
    //   };
    // case actionDescriptors.transferCategoryOwnershipSuccessful:
    //   return {
    //     ...state,
    //     categoryOwnership: action.payload,
    //     isOwnershipcategoryTransferring: false
    //   };
    // case actionDescriptors.transferCategoryOwnershipFailed:
    //   return {
    //     ...state,
    //     error: action.error,
    //     isOwnershipcategoryTransferring: false
    //   };
    // case actionDescriptors.updateCategory:
    //   return {
    //     ...state,
    //     iscategoryUpdating: true
    //   };
    // case actionDescriptors.updateCategorySuccessful:
    //   return {
    //     ...state,
    //     categoryUpdateObject: action.payload,
    //     iscategoryUpdating: false
    //   };
    // case actionDescriptors.updateCategoryFailed:
    //   return {
    //     ...state,
    //     error: action.error,
    //     iscategoryUpdating: false
    //   };
    // case actionDescriptors.fetchCategoryAudit:
    //   return {
    //     ...state,
    //     iscategorysAuditLoading: true
    //   };
    // case actionDescriptors.fetchCategoryAuditSuccessful:
    //   return {
    //     ...state,
    //     categorysAudit: action.payload,
    //     iscategorysAuditLoading: false
    //   };
    // case actionDescriptors.fetchCategoryAuditFailed:
    //   return {
    //     ...state,
    //     error: action.error,
    //     iscategorysAuditLoading: false
    //   };
    // case actionDescriptors.importAssetRequest:
    //   return {
    //     ...state,
    //     isAssetImportInProgress: true,
    //     assetsUploaded: 0,
    //     assetsUploadedErrors: []
    //   }
    // case actionDescriptors.importAssetSuccess:
    //   return {
    //     ...state,
    //     isAssetImportInProgress: false,
    //     error: null
    //   }
    // case actionDescriptors.importAssetFailure:
    //   return {
    //     ...state,
    //     error: action.error,
    //     isAssetImportInProgress: false,
    //     isImportAssetsModalOpen: true
    //   }
    // case actionDescriptors.updateAssetImportCount:
    //   return {
    //     ...state,
    //     assetsUploaded: action.count
    //   }
    // case actionDescriptors.updateAssetUploadError:
    //   return {
    //     ...state,
    //     assetsUploadedErrors: action.errors
    //   }
    // case actionDescriptors.openImportCSVModal:
    //   return {
    //     ...state,
    //     isImportAssetsModalOpen: true
    //   }
    // case actionDescriptors.closeImportCSVModal:
    //   return {
    //     ...state,
    //     isImportAssetsModalOpen: false
    //   }
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
