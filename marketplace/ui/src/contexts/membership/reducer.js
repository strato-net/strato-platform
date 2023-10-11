import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.fetchMembershipFromDetails:
      return {
        ...state,
        isMembershipLoading: true
      };
    case actionDescriptors.fetchMembershipFromDetailsSuccessful:
      return {
        ...state,
        membershipServices: action.payload.membershipServices,
        membership: action.payload.membership,
        productFiles: action.payload.productFiles,
        isMembershipLoading: false
      };
    case actionDescriptors.fetchMembershipFromDetailsFailed:
      return {
        ...state,
        error: action.error,
        isMembershipLoading: false
      };

    case actionDescriptors.fetchPurchasedMemberships:
      return {
        ...state,
        isPurchasedMembershipLoading: true
      };
    case actionDescriptors.fetchPurchasedMembershipsSuccessful:
      return {
        ...state,
        purchasedMemberships: action.payload,
        isPurchasedMembershipLoading: false
      };
    case actionDescriptors.fetchPurchasedMembershipsFailed:
      return {
        ...state,
        error: action.error,
        isPurchasedMembershipLoading: false
      };

    case actionDescriptors.fetchIssuedMemberships:
      return {
        ...state,
        isIssuedMembershipLoading: true
      };
    case actionDescriptors.fetchIssuedMembershipsSuccessful:
      return {
        ...state,
        issuedMembership: action.payload,
        isIssuedMembershipLoading: false
      };
    case actionDescriptors.fetchIssuedMembershipsFailed:
      return {
        ...state,
        error: action.error,
        isIssuedMembershipLoading: false
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
    case actionDescriptors.createMembership:
      return {
        ...state,
        isCreateMembershipSubmitting: true
      };
    case actionDescriptors.createMembershipSuccessful:
      return {
        ...state,
        membership: action.payload,
        isCreateMembershipSubmitting: false
      };
    case actionDescriptors.createMembershipFailed:
      return {
        ...state,
        error: action.error,
        isCreateMembershipSubmitting: false
      };
    // Resale membership
    case actionDescriptors.resaleMembership:
      return {
        ...state,
        isResaleMembershipSubmitting: true
      };
    case actionDescriptors.resaleMembershipSuccessful:
      return {
        ...state,
        membership: action.payload,
        isResaleMembershipSubmitting: false
      };
    case actionDescriptors.resaleMembershipFailed:
      return {
        ...state,
        error: action.error,
        isResaleMembershipSubmitting: false
      };

    case actionDescriptors.fetchMembership:
      return {
        ...state,
        isMembershipsLoading: true
      };
    case actionDescriptors.fetchMembershipSuccessful:
      return {
        ...state,
        memberships: action.payload,
        totalMemberships: action.payload.total,
        isMembershipsLoading: false
      };
    case actionDescriptors.fetchMembershipFailed:
      return {
        ...state,
        error: action.error,
        isMembershipsLoading: false
      };
    case actionDescriptors.fetchMembershipDetails:
      return {
        ...state,
        ismembershipDetailsLoading: true
      };
    case actionDescriptors.fetchMembershipDetailsSuccessful:
      return {
        ...state,
        membershipDetails: action.payload,
        ismembershipDetailsLoading: false
      };
    case actionDescriptors.fetchMembershipDetailsFailed:
      return {
        ...state,
        error: action.error,
        ismembershipDetailsLoading: false
      };
    case actionDescriptors.transferMembershipOwnership:
      return {
        ...state,
        isOwnershipmembershipTransferring: true
      };
    case actionDescriptors.transferMembershipOwnershipSuccessful:
      return {
        ...state,
        membershipOwnership: action.payload,
        isOwnershipmembershipTransferring: false
      };
    case actionDescriptors.transferMembershipOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isOwnershipmembershipTransferring: false
      };
    case actionDescriptors.updateMembership:
      return {
        ...state,
        ismembershipUpdating: true
      };
    case actionDescriptors.updateMembershipSuccessful:
      return {
        ...state,
        membershipUpdateObject: action.payload,
        ismembershipUpdating: false
      };
    case actionDescriptors.updateMembershipFailed:
      return {
        ...state,
        error: action.error,
        ismembershipUpdating: false
      };
    case actionDescriptors.fetchMembershipAudit:
      return {
        ...state,
        ismembershipsAuditLoading: true
      };
    case actionDescriptors.fetchMembershipAuditSuccessful:
      return {
        ...state,
        membershipsAudit: action.payload,
        ismembershipsAuditLoading: false
      };
    case actionDescriptors.fetchMembershipAuditFailed:
      return {
        ...state,
        error: action.error,
        ismembershipsAuditLoading: false
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
    case actionDescriptors.onboardSellerToStripe:
      return {
        ...state,
        isOnboardingSellerToStripe: true
      };
    case actionDescriptors.onboardSellerToStripeSuccessful:
      return {
        ...state,
        onboardedSeller: action.payload,
        isOnboardingSellerToStripe: false
      };
    case actionDescriptors.onboardSellerToStripeFailed:
      return {
        ...state,
        error: action.error,
        isOnboardingSellerToStripe: false
      };
    case actionDescriptors.sellerStripeStatus:
      return {
        ...state,
        isLoadingStripeStatus: true
      };
    case actionDescriptors.sellerStripeStatusSuccessful:
      return {
        ...state,
        stripeStatus: action.payload,
        isLoadingStripeStatus: false
      };
    case actionDescriptors.sellerStripeStatusFailed:
      return {
        ...state,
        error: action.error,
        isLoadingStripeStatus: false
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
