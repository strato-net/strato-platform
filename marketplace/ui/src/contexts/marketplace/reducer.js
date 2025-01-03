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
    case actionDescriptors.fetchMarketplace:
      return {
        ...state,
        isMarketplaceLoading: true,
      };
    case actionDescriptors.fetchMarketplaceSuccessful:
      return {
        ...state,
        marketplaceList: action.payload.productsWithImageUrl,
        marketplaceListCount: action.payload.inventoryCount,
        isMarketplaceLoading: false,
      };
    case actionDescriptors.fetchMarketplaceFailed:
      return {
        ...state,
        error: action.error,
        isMarketplaceLoading: false,
      };
    case actionDescriptors.fetchMarketplaceLoggedIn:
      return {
        ...state,
        isMarketplaceLoading: true,
      };
    case actionDescriptors.fetchMarketplaceLoggedInSuccessful:
      return {
        ...state,
        marketplaceList: action.payload.productsWithImageUrl,
        marketplaceListCount: action.payload.inventoryCount,
        isMarketplaceLoading: false,
      };
    case actionDescriptors.fetchMarketplaceLoggedInFailed:
      return {
        ...state,
        error: action.error,
        isMarketplaceLoading: false,
      };
    case actionDescriptors.fetchCartItems:
      return {
        ...state,
      };
    case actionDescriptors.fetchCartItemsSuccessful:
      return {
        ...state,
        cartList: action.payload,
      };
    case actionDescriptors.fetchCartItemsFailed:
      return {
        ...state,
        error: action.error,
      };
    case actionDescriptors.addItemToCart:
      return {
        ...state,
      };
    case actionDescriptors.addItemToCartSuccessful:
      return {
        ...state,
        cartList: action.payload,
      };
    case actionDescriptors.addItemToCartFailed:
      return {
        ...state,
        error: action.error,
      };
    case actionDescriptors.fetchConfirmOrderItems:
      return {
        ...state,
      };
    case actionDescriptors.fetchConfirmOrderItemsSuccessful:
      return {
        ...state,
        confirmOrderList: action.payload,
      };
    case actionDescriptors.fetchConfirmOrderItemsFailed:
      return {
        ...state,
        error: action.error,
      };
    case actionDescriptors.addItemToConfirmOrder:
      return {
        ...state,
      };
    case actionDescriptors.addItemToConfirmOrderSuccessful:
      return {
        ...state,
        confirmOrderList: action.payload,
      };
    case actionDescriptors.addItemToConfirmOrderFailed:
      return {
        ...state,
        error: action.error,
      };
    case actionDescriptors.deleteCartItem:
      return {
        ...state,
      };
    case actionDescriptors.deleteCartItemSuccesful:
      return {
        ...state,
        cartList: action.payload,
      };
    case actionDescriptors.deleteCartItemFailed:
      return {
        ...state,
        error: action.error,
      };
    //top selling products
    case actionDescriptors.fetchTopSellingProducts:
      return {
        ...state,
        isTopSellingProductsLoading: true,
      };
    case actionDescriptors.fetchTopSellingProductsSuccessful:
      return {
        ...state,
        topSellingProducts: action.payload,
        isTopSellingProductsLoading: false,
      };
    case actionDescriptors.fetchTopSellingProductsFailed:
      return {
        ...state,
        error: action.error,
        isTopSellingProductsLoading: false,
      };
    case actionDescriptors.fetchTopSellingProductsLoggedIn:
      return {
        ...state,
        isTopSellingProductsLoading: true,
      };
    case actionDescriptors.fetchTopSellingProductsLoggedInSuccessful:
      return {
        ...state,
        topSellingProducts: action.payload,
        isTopSellingProductsLoading: false,
      };
    case actionDescriptors.fetchTopSellingProductsLoggedInFailed:
      return {
        ...state,
        error: action.error,
        isTopSellingProductsLoading: false,
      };

    case actionDescriptors.fetchStakeableProducts:
      return {
        ...state,
        isStakeableProductsLoading: true,
      };
    case actionDescriptors.fetchStakeableProductsSuccessful:
      return {
        ...state,
        stakeableProducts: action.payload,
        isStakeableProductsLoading: false,
      };
    case actionDescriptors.fetchStakeableProductsFailed:
      return {
        ...state,
        error: action.error,
        isStakeableProductsLoading: false,
      };

    //shipping address adding
    case actionDescriptors.addShippingAddress:
      return {
        ...state,
        isAddingShippingAddress: true,
      };
    case actionDescriptors.addShippingAddressSuccessful:
      return {
        ...state,
        shippingAddress: action.payload,
        isAddingShippingAddress: false,
      };
    case actionDescriptors.addShippingAddressFailed:
      return {
        ...state,
        error: action.error,
        isAddingShippingAddress: false,
      };
    case actionDescriptors.fetchUserAddress:
      return {
        ...state,
        isLoadingUserAddress: true,
      };
    case actionDescriptors.fetchUserAddressSuccessful:
      return {
        ...state,
        userAddress: action.payload,
        isLoadingUserAddress: false,
      };
    case actionDescriptors.fetchUserAddressFailed:
      return {
        ...state,
        error: action.error,
        isLoadingUserAddress: false,
      };
    case actionDescriptors.fetchUserAddresses:
      return {
        ...state,
        isLoadingUserAddresses: true,
      };
    case actionDescriptors.fetchUserAddressesSuccessful:
      return {
        ...state,
        userAddresses: action.payload,
        isLoadingUserAddresses: false,
      };
    case actionDescriptors.fetchUserAddressesFailed:
      return {
        ...state,
        error: action.error,
        isLoadingUserAddresses: false,
      };
    case actionDescriptors.fetchUSDSTBalance:
      return {
        ...state,
        isFetchingUSDST: true,
      };
    case actionDescriptors.fetchUSDSTBalanceSuccessful:
      return {
        ...state,
        isFetchingUSDST: false,
        USDST: action.payload,
      };
    case actionDescriptors.fetchUSDSTBalanceFailed:
      return {
        ...state,
        isFetchingUSDST: false,
      };
    case actionDescriptors.fetchCataBalance:
      return {
        ...state,
        isFetchingCata: true,
      };
    case actionDescriptors.fetchCataBalanceSuccessful:
      return {
        ...state,
        isFetchingCata: false,
        cata: action.payload,
      };
    case actionDescriptors.fetchCataBalanceFailed:
      return {
        ...state,
        isFetchingCata: false,
      };
    case actionDescriptors.fetchUSDSTAddress:
      return {
        ...state,
      };
    case actionDescriptors.fetchUSDSTAddressSuccessful:
      return {
        ...state,
        USDSTAddress: action.payload,
      };
    case actionDescriptors.fetchUSDSTAddressFailed:
      return {
        ...state,
      };
    case actionDescriptors.fetchStratsAddress:
      return {
        ...state,
      };
    case actionDescriptors.fetchStratsAddressSuccessful:
      return {
        ...state,
        stratsAddress: action.payload,
      };
    case actionDescriptors.fetchStratsAddressFailed:
      return {
        ...state,
      };
    case actionDescriptors.fetchAssetsWithEighteenDecimalPlaces:
      return {
        ...state,
        isFetchingAssetsWithEighteenDecimalPlaces: true,
      };
    case actionDescriptors.fetchAssetsWithEighteenDecimalPlacesSuccessful:
      return {
        ...state,
        isFetchingAssetsWithEighteenDecimalPlaces: false,
        assetsWithEighteenDecimalPlaces: action.payload,
      };
    case actionDescriptors.fetchAssetsWithEighteenDecimalPlacesFailed:
      return {
        ...state,
        isFetchingAssetsWithEighteenDecimalPlaces: false,
      };

    case actionDescriptors.fetchCataAddress:
      return {
        ...state,
      };
    case actionDescriptors.fetchCataAddressSuccessful:
      return {
        ...state,
        cataAddress: action.payload,
      };
    case actionDescriptors.fetchCataAddressFailed:
      return {
        ...state,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
