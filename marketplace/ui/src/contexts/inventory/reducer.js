import { actionDescriptors } from './actions';

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.resetMessage:
      return {
        ...state,
        success: false,
        message: null,
      };
    case actionDescriptors.setMessage:
      return {
        ...state,
        success: action.success,
        message: action.message,
      };
    case actionDescriptors.createInventory:
      return {
        ...state,
        isCreateInventorySubmitting: true,
      };
    case actionDescriptors.createInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isCreateInventorySubmitting: false,
      };
    case actionDescriptors.createInventoryFailed:
      return {
        ...state,
        error: action.error,
        isCreateInventorySubmitting: false,
      };
    case actionDescriptors.fetchInventory:
      return {
        ...state,
        isInventoriesLoading: true,
      };
    case actionDescriptors.fetchInventorySuccessful:
      return {
        ...state,
        inventories: action.payload.data,
        inventoriesTotal: action.payload.count,
        isInventoriesLoading: false,
      };
    case actionDescriptors.fetchInventoryFailed:
      return {
        ...state,
        error: action.error,
        isInventoriesLoading: false,
      };
    case actionDescriptors.fetchInventoryForUser:
      return {
        ...state,
        isUserInventoriesLoading: true,
      };
    case actionDescriptors.fetchInventoryForUserSuccessful:
      return {
        ...state,
        userInventories: action.payload.data,
        userInventoriesTotal: action.payload.count,
        isUserInventoriesLoading: false,
      };
    case actionDescriptors.fetchInventoryForUserFailed:
      return {
        ...state,
        error: action.error,
        isUserInventoriesLoading: false,
      };
    case actionDescriptors.fetchInventorySearch:
      return {
        ...state,
        isInventoriesLoading: true,
      };
    case actionDescriptors.fetchInventorySearchSuccessful:
      return {
        ...state,
        inventories: action.payload.data,
        inventoriesTotal: action.payload.count,
        isInventoriesLoading: false,
      };
    case actionDescriptors.fetchInventorySearchFailed:
      return {
        ...state,
        error: action.error,
        isInventoriesLoading: false,
      };
    case actionDescriptors.updateInventory:
      return {
        ...state,
        isinventoryUpdating: true,
      };
    case actionDescriptors.updateInventorySuccessful:
      return {
        ...state,
        inventoryUpdateObject: action.payload,
        isinventoryUpdating: false,
      };
    case actionDescriptors.updateInventoryFailed:
      return {
        ...state,
        error: action.error,
        isinventoryUpdating: false,
      };
    case actionDescriptors.updateSale:
      return {
        ...state,
        issaleUpdating: true,
      };
    case actionDescriptors.updateSaleSuccessful:
      return {
        ...state,
        saleUpdateObject: action.payload,
        issaleUpdating: false,
      };
    case actionDescriptors.updateSaleFailed:
      return {
        ...state,
        error: action.error,
        issaleUpdating: false,
      };
    case actionDescriptors.listInventory:
      return {
        ...state,
        isListing: true,
      };
    case actionDescriptors.listInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isListing: false,
      };
    case actionDescriptors.listInventoryFailed:
      return {
        ...state,
        error: action.error,
        isListing: false,
      };
    case actionDescriptors.unlistInventory:
      return {
        ...state,
        isUnlisting: true,
      };
    case actionDescriptors.unlistInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isUnlisting: false,
      };
    case actionDescriptors.unlistInventoryFailed:
      return {
        ...state,
        error: action.error,
        isUnlisting: false,
      };

     // ------------------------------------------------------------------------------------------------------
    case actionDescriptors.stakeInventory:
      return {
        ...state,
        isStaking: true
      };
    case actionDescriptors.stakeInventorySuccessful:
      return {
        ...state,
        isStaking: false
      };
    case actionDescriptors.stakeInventoryFailed:
      return {
        ...state,
        error: action.error,
        isStaking: false
      };
    
    case actionDescriptors.unstakeInventory:
      return {
        ...state,
        isUnstaking: true
      };
    case actionDescriptors.unstakeInventorySuccessful:
      return {
        ...state,
        isUnstaking: false
      };
    case actionDescriptors.unstakeInventoryFailed:
      return {
        ...state,
        error: action.error,
        isUnstaking: false
      };
    
    case actionDescriptors.borrow:
      return {
        ...state,
        isBorrowing: true
      };
    case actionDescriptors.borrowSuccessful:
      return {
        ...state,
        isBorrowing: false
      };
    case actionDescriptors.borrowFailed:
      return {
        ...state,
        error: action.error,
        isBorrowing: false
      };
    
    case actionDescriptors.repay:
      return {
        ...state,
        isRepaying: true
      };
    case actionDescriptors.repaySuccessful:
      return {
        ...state,
        isRepaying: false
      };
    case actionDescriptors.repayFailed:
        return {
          ...state,
          error: action.error,
          isRepaying: false
        };

    case actionDescriptors.getReserve:
        return {
          ...state,
          isReserveLoading: true
        };
    case actionDescriptors.getReserveSuccessful:
        return {
          ...state,
          reserve: action.payload,
          isReserveLoading: false
        };
    case actionDescriptors.getReserveFailed:
        return {
          ...state,
          error: action.error,
          isReserveLoading: false
        };
    
    case actionDescriptors.getAllReserve:
        return {
          ...state,
          isReservesLoading: true
        };
    case actionDescriptors.getAllReserveSuccessful:
        return {
          ...state,
          reserves: action.payload,
          isReservesLoading: false
        };
    case actionDescriptors.getAllReserveFailed:
        return {
          ...state,
          error: action.error,
          isReservesLoading: false
        };
    
    case actionDescriptors.getEscrowForAsset:
        return {
          ...state,
          isEscrowLoading: true
        };
    case actionDescriptors.getEscrowForAssetSuccessful:
        return {
          ...state,
          escrow: action.payload,
          isEscrowLoading: false
        };
    case actionDescriptors.getEscrowForAssetFailed:
        return {
          ...state,
          error: action.error,
          isEscrowLoading: false
        };

    case actionDescriptors.getUserCataRewards:
        return {
          ...state,
          isUserCataRewardsLoading: true
        };
    case actionDescriptors.getUserCataRewardsSuccessful:
        return {
          ...state,
          totalCataReward: action.payload.totalCataReward,
          dailyCataReward: action.payload.dailyCataReward,
          isUserCataRewardsLoading: false
        };
    case actionDescriptors.getUserCataRewardsFailed:
        return {
          ...state,
          error: action.error,
          isUserCataRewardsLoading: false
        };
    
    case actionDescriptors.getOracle:
          return {
            ...state,
            isFetchingOracle: true
          };
    case actionDescriptors.getOracleSuccessful:
          return {
            ...state,
            oracle: action.payload,
            isFetchingOracle: false
          };
    case actionDescriptors.getOracleFailed:
          return {
            ...state,
            error: action.error,
            isFetchingOracle: false
          };    
    // ------------------------------------------------------------------------------------------------------
    case actionDescriptors.resellInventory:
      return {
        ...state,
        isReselling: true,
      };
    case actionDescriptors.resellInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isReselling: false,
      };
    case actionDescriptors.resellInventoryFailed:
      return {
        ...state,
        error: action.error,
        isReselling: false,
      };
    case actionDescriptors.fetchSupportedTokens:
      return {
        ...state,
        isFetchingTokens: true,
      };
    case actionDescriptors.fetchSupportedTokensSuccessful:
      return {
        ...state,
        supportedTokens: action.payload,
        isFetchingTokens: false,
      };
    case actionDescriptors.fetchSupportedTokensFailed:
      return {
        ...state,
        error: action.error,
        isFetchingTokens: false,
      };
    case actionDescriptors.bridgeInventory:
      return {
        ...state,
        isBridging: true,
      };
    case actionDescriptors.bridgeInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isBridging: false,
      };
    case actionDescriptors.bridgeInventoryFailed:
      return {
        ...state,
        error: action.error,
        isBridging: false,
      };
    case actionDescriptors.transferInventory:
      return {
        ...state,
        isTransferring: true,
      };
    case actionDescriptors.transferInventorySuccessful:
      return {
        ...state,
        isTransferring: false,
      };
    case actionDescriptors.transferInventoryFailed:
      return {
        ...state,
        error: action.error,
        isTransferring: false,
      };
    case actionDescriptors.fetchItemTransfers:
      return {
        ...state,
        isFetchingItemTransfers: true,
      };
    case actionDescriptors.fetchItemTransfersSuccessful:
      return {
        ...state,
        itemTransfers: action.payload.transfers,
        totalItemsTransfered: action.payload.total,
        isFetchingItemTransfers: false,
      };
    case actionDescriptors.fetchItemTransfersFailed:
      return {
        ...state,
        error: action.error,
        isFetchingItemTransfers: false,
      };
    case actionDescriptors.fetchInventoryOwnershipHistory:
      return {
        ...state,
        isInventoryOwnershipHistoryLoading: true,
      };
    case actionDescriptors.fetchInventoryOwnershipHistorySuccessful:
      return {
        ...state,
        inventoryOwnershipHistory: action.payload,
        isInventoryOwnershipHistoryLoading: false,
      };
    case actionDescriptors.fetchInventoryOwnershipHistoryFailed:
      return {
        ...state,
        error: action.error,
        isInventoryOwnershipHistoryLoading: false,
      };
    case actionDescriptors.fetchInventoryDetail:
      return {
        ...state,
        isInventoryDetailsLoading: true,
      };
    case actionDescriptors.fetchInventoryDetailSuccessful:
      return {
        ...state,
        inventoryDetails: action.payload,
        isInventoryDetailsLoading: false,
      };
    case actionDescriptors.fetchInventoryDetailFailed:
      return {
        ...state,
        error: action.error,
        isInventoryDetailsLoading: false,
      };
    case actionDescriptors.uploadImage:
      return {
        ...state,
        isUploadImageSubmitting: true,
      };
    case actionDescriptors.uploadImageSuccessful:
      return {
        ...state,
        uploadedImg: action.payload,
        isUploadImageSubmitting: false,
      };
    case actionDescriptors.uploadImageFailed:
      return {
        ...state,
        error: action.error,
        isUploadImageSubmitting: false,
      };
    case actionDescriptors.createItem:
      return {
        ...state,
        isCreateInventorySubmitting: true,
      };
    case actionDescriptors.createItemSuccessful:
      return {
        ...state,
        isCreateInventorySubmitting: false,
      };
    case actionDescriptors.createItemFailed:
      return {
        ...state,
        error: action.error,
        isCreateInventorySubmitting: false,
      };
    case actionDescriptors.fetchPriceHistory:
      return {
        ...state,
        isFetchingPriceHistory: true,
      };
    case actionDescriptors.fetchPriceHistorySuccessful:
      return {
        ...state,
        isFetchingPriceHistory: false,
        priceHistory: action.payload,
      };
    case actionDescriptors.fetchPriceHistoryFailed:
      return {
        ...state,
        isFetchingPriceHistory: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
