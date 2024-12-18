import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  fetchMarketplace: 'fetch_marketplace',
  fetchMarketplaceSuccessful: 'fetch_marketplace_successful',
  fetchMarketplaceFailed: 'fetch_marketplace_failed',
  fetchMarketplaceLoggedIn: 'fetch_marketplace_logged_in',
  fetchMarketplaceLoggedInSuccessful: 'fetch_marketplace_logged_in_successful',
  fetchMarketplaceLoggedInFailed: 'fetch_marketplace_logged_in_failed',
  fetchTopSellingProducts: 'fetch_top_selling_products',
  fetchTopSellingProductsSuccessful: 'fetch_top_selling_products_successful',
  fetchTopSellingProductsFailed: 'fetch_top_selling_products_failed',
  fetchTopSellingProductsLoggedIn: 'fetch_top_selling_products_logged_in',
  fetchTopSellingProductsLoggedInSuccessful:
    'fetch_top_selling_products_logged_in_successful',
  fetchTopSellingProductsLoggedInFailed:
    'fetch_top_selling_products_logged_in_failed',
  fetchStakeableProducts: 'fetch_stakeable_products',
  fetchStakeableProductsSuccessful: 'fetch_stakeable_products_successful',
  fetchStakeableProductsFailed: 'fetch_stakeable_products_failed',
  resetMessage: 'reset_message',
  setMessage: 'set_message',
  addItemToCart: 'add_item_to_cart',
  addItemToCartSuccessful: 'add_item_to_cart_successful',
  addItemToCartFailed: 'add_item_to_cart_failed',
  fetchCartItems: 'fetch_cart_items',
  fetchCartItemsSuccessful: 'fetch_cart_items_successful',
  fetchCartItemsFailed: 'fetch_cart_items_failed',
  addItemToConfirmOrder: 'add_item_to_confirm_order',
  addItemToConfirmOrderSuccessful: 'add_item_to_confirm_order_successful',
  addItemToConfirmOrderFailed: 'add_item_to_confirm_order_failed',
  fetchConfirmOrderItems: 'fetch_confirm_order_items',
  fetchConfirmOrderItemsSuccessful: 'fetch_confirm_order_items_successful',
  fetchConfirmOrderItemsFailed: 'fetch_confirm_order_items_failed',
  deleteCartItem: 'delete_cart_item',
  deleteCartItemSuccesful: 'delete_cart_item_successful',
  deleteCartItemFailed: 'delete_cart_item_failed',
  addShippingAddress: 'add_shipping_address',
  addShippingAddressSuccessful: 'add_shipping_address_successful',
  addShippingAddressFailed: 'add_shipping_address_failed',
  fetchUserAddress: 'fetch_user_address',
  fetchUserAddressSuccessful: 'fetch_user_address_successful',
  fetchUserAddressFailed: 'fetch_user_address_failed',
  fetchUserAddresses: 'fetch_user_addresses',
  fetchUserAddressesSuccessful: 'fetch_user_addresses_successful',
  fetchUserAddressesFailed: 'fetch_user_addresses_failed',
  fetchUsdstBalance: 'fetch_usdst_balance',
  fetchUsdstBalanceSuccessful: 'fetch_usdst_balance_successful',
  fetchUsdstBalanceFailed: 'fetch_usdst_balance_failed',
  fetchCataBalance: 'fetch_cata_balance',
  fetchCataBalanceSuccessful: 'fetch_cata_balance_successful',
  fetchCataBalanceFailed: 'fetch_cata_balance_failed',
  fetchUsdstAddress: 'fetch_usdst_address',
  fetchUsdstAddressSuccessful: 'fetch_usdst_address_successful',
  fetchUsdstAddressFailed: 'fetch_usdst_address_failed',
  fetchAssetsWithEighteenDecimalPlaces: 'fetch_assets_with_eighteen_decimal_places',
  fetchAssetsWithEighteenDecimalPlacesSuccessful: 'fetch_assets_with_eighteen_decimal_places_successful',
  fetchAssetsWithEighteenDecimalPlacesFailed: 'fetch_assets_with_eighteen_decimal_places_failed',
  fetchCataAddress: 'fetch_cata_address',
  fetchCataAddressSuccessful: 'fetch_cata_address_successful',
  fetchCataAddressFailed: 'fetch_cata_address_failed',
  fetchUsdstTransactionHistory: 'fetch_usdst_transaction_history',
  fetchUsdstTransactionHistorySuccessful:
    'fetch_usdst_transaction_history_successful',
  fetchUsdstTransactionHistoryFailed:
    'fetch_usdst_transaction_history_failed',
  transferUsdst: 'transfer_usdst',
  transferUsdstSuccessful: 'transfer_usdst_successful',
  transferUsdstFailed: 'transfer_usdst_failed',
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  fetchCartItems: (dispatch, cartList) => {
    dispatch({ type: actionDescriptors.fetchCartItems });
    try {
      // let cartItems = window.localStorage.getItem("cartList") ?? [];
      dispatch({
        type: actionDescriptors.fetchCartItemsSuccessful,
        payload: cartList,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchCartItemsFailed,
        error: undefined,
      });
    }
  },

  addItemToCart: (dispatch, cartList) => {
    dispatch({ type: actionDescriptors.addItemToCart });
    try {
      // window.localStorage.setItem("cartList", JSON.stringify(cartList));
      dispatch({
        type: actionDescriptors.addItemToCartSuccessful,
        payload: cartList,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.addItemToCartFailed,
        error: undefined,
      });
    }
  },

  deleteCartItem: (dispatch, cartList) => {
    dispatch({ type: actionDescriptors.deleteCartItem });
    try {
      // window.localStorage.setItem("cartList", JSON.stringify(cartList));
      dispatch({
        type: actionDescriptors.deleteCartItemSuccesful,
        payload: cartList,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.deleteCartItemFailed,
        error: undefined,
      });
    }
  },

  fetchConfirmOrderItems: (dispatch, cartList) => {
    dispatch({ type: actionDescriptors.fetchConfirmOrderItems });
    try {
      // let cartItems = window.localStorage.getItem("cartList") ?? [];
      dispatch({
        type: actionDescriptors.fetchConfirmOrderItemsSuccessful,
        payload: cartList,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchConfirmOrderItemsFailed,
        error: undefined,
      });
    }
  },

  addItemToConfirmOrder: (dispatch, cartList) => {
    dispatch({ type: actionDescriptors.addItemToConfirmOrder });
    try {
      window.localStorage.setItem('confirmOrderList', JSON.stringify(cartList));
      dispatch({
        type: actionDescriptors.addItemToConfirmOrderSuccessful,
        payload: cartList,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.addItemToConfirmOrderFailed,
        error: undefined,
      });
    }
  },

  fetchMarketplace: async (
    dispatch,
    categorys,
    subCategorys,
    minPrice,
    maxPrice,
    search,
    availabilityQuery,
    offset,
    limit
  ) => {
    dispatch({ type: actionDescriptors.fetchMarketplace });

    const categoryQuery = categorys ? `&category[]=${categorys}` : '';

    const subCategoryQuery = subCategorys
      ? `&subCategory[]=${subCategorys}`
      : '';

    const searchQuery = search ? `&queryValue=${search}&queryFields=name` : '';
    const priceQuery = `&range[]=price,${minPrice},${maxPrice}`;
    // const sortLatest = "&order=createdDate.desc"

    try {
      const response = await fetch(
        `${apiUrl}/marketplace?${priceQuery}${categoryQuery}${subCategoryQuery}${searchQuery}${availabilityQuery}`,
        {
          method: HTTP_METHODS.GET,
          headers: {
            offset: `${offset}`,
            limit: `${limit}`,
          },
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMarketplaceSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchMarketplaceFailed,
          error: 'Error while fetching marketplace products',
        });
      }

      dispatch({
        type: actionDescriptors.fetchMarketplaceFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchMarketplaceFailed,
        error: 'Error while fetching marketplace products',
      });
    }
  },

  fetchMarketplaceLoggedIn: async (
    dispatch,
    categorys,
    subCategorys,
    minPrice,
    maxPrice,
    search,
    availabilityQuery,
    offset,
    limit
  ) => {
    dispatch({ type: actionDescriptors.fetchMarketplaceLoggedIn });

    const categoryQuery = categorys ? `&category[]=${categorys}` : '';

    const subCategoryQuery = subCategorys
      ? `&subCategory[]=${subCategorys}`
      : '';

    const priceQuery = `&range[]=price,${minPrice},${maxPrice}`;
    // const sortLatest = "&order=createdDate.desc"
    const searchQuery = search ? `&queryValue=${search}&queryFields=name` : '';

    try {
      const response = await fetch(
        `${apiUrl}/marketplace/all?${priceQuery}${categoryQuery}${subCategoryQuery}${searchQuery}${availabilityQuery}`,
        {
          method: HTTP_METHODS.GET,
          headers: {
            offset: `${offset}`,
            limit: `${limit}`,
          },
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMarketplaceLoggedInSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchMarketplaceLoggedInFailed,
          error: 'Error while fetching marketplace products',
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchMarketplaceLoggedInFailed,
          error: 'Unauthorized while fetching marketplace products',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchMarketplaceLoggedInFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchMarketplaceLoggedInFailed,
        error: 'Error while fetching marketplace products',
      });
    }
  },

  fetchTopSellingProducts: async (dispatch, offset, limit) => {
    dispatch({ type: actionDescriptors.fetchTopSellingProducts });

    try {
      const response = await fetch(
        `${apiUrl}/marketplace/topselling?offset=${offset}&limit=${limit}&gtField=quantity&gtValue=0`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchTopSellingProductsSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({
        type: actionDescriptors.fetchTopSellingProductsFailed,
        error: undefined,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchTopSellingProductsFailed,
        error: undefined,
      });
    }
  },

  fetchTopSellingProductsLoggedIn: async (dispatch, offset, limit) => {
    dispatch({ type: actionDescriptors.fetchTopSellingProductsLoggedIn });

    try {
      const response = await fetch(
        `${apiUrl}/marketplace/user/topselling?offset=${offset}&limit=${limit}&gtField=quantity&gtValue=0`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchTopSellingProductsLoggedInSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchTopSellingProductsLoggedInFailed,
          error: 'Unauthorized while fetching trending items',
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.fetchTopSellingProductsLoggedInFailed,
        error: undefined,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchTopSellingProductsLoggedInFailed,
        error: undefined,
      });
    }
  },

  fetchStakeableProducts: async (
    dispatch,
    assetAddresses
  ) => {
    dispatch({ type: actionDescriptors.fetchStakeableProducts });

    const addressQuery = assetAddresses ? `assetAddresses[]=${assetAddresses}` : '';

    try {
      const response = await fetch(
        `${apiUrl}/marketplace/stake?${addressQuery}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchStakeableProductsSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchStakeableProductsFailed,
          error: 'Unauthorized while fetching trending items',
        });
      }
      dispatch({
        type: actionDescriptors.fetchStakeableProductsFailed,
        error: undefined,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchStakeableProductsFailed,
        error: undefined,
      });
    }
  },

  addShippingAddress: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.addShippingAddress });
    try {
      const response = await fetch(`${apiUrl}/order/userAddress`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.addShippingAddressSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Address added successfully', true);
        return body.data;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.addShippingAddressFailed,
          error: 'Error while adding Shipping address',
        });
        actions.setMessage(dispatch, 'Error while adding Shipping address');
        return null;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.addShippingAddressFailed,
          error: 'Unauthorized while adding Shipping address',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.addShippingAddressFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.addShippingAddressFailed,
        error: 'Error while adding Shipping address',
      });
      actions.setMessage(dispatch, 'Error while adding Shipping address');
    }
  },

  fetchUserAddress: async (dispatch, redemptionService, shippingAddressId) => {
    dispatch({ type: actionDescriptors.fetchUserAddress });
    const redemptionArg = redemptionService ? `/${redemptionService}` : '';

    try {
      const response = await fetch(
        `${apiUrl}/order/userAddress${redemptionArg}/${shippingAddressId}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUserAddressSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchUserAddressFailed,
          error: 'Error while getting Shipping address',
        });
        actions.setMessage(dispatch, 'Error while getting Shipping address');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchUserAddressFailed,
          error: 'Unauthorized while fetching Shipping address',
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.fetchUserAddressFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUserAddressFailed,
        error: undefined,
      });
      actions.setMessage(dispatch, 'Error while getting Shipping address');
    }
  },

  fetchUserAddresses: async (dispatch, redemptionService) => {
    dispatch({ type: actionDescriptors.fetchUserAddresses });

    const redemptionArg = redemptionService ? `/${redemptionService}` : '';
    try {
      const response = await fetch(
        `${apiUrl}/order/userAddresses/user${redemptionArg}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUserAddressesSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchUserAddressesFailed,
          error: 'Error while getting Shipping address',
        });
        actions.setMessage(dispatch, 'Error while getting Shipping address');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchUserAddressesFailed,
          error: 'Unauthorized while fetching Shipping addresses',
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.fetchUserAddressesFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUserAddressesFailed,
        error: undefined,
      });
      actions.setMessage(dispatch, 'Error while getting Shipping address');
    }
  },
  fetchUsdstBalance: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchUsdstBalance });
    try {
      let response = await fetch(`${apiUrl}/marketplace/usdst`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });
      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchUsdstBalanceFailed,
          payload: 'Error while fetching USDST',
        });
      }
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUsdstBalanceSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({
        type: actionDescriptors.fetchUsdstBalanceFailed,
        payload: 'Error while fetching USDST',
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUsdstBalanceFailed,
        payload: 'Error while fetching USDST',
      });
    }
  },
  fetchCataBalance: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchCataBalance });
    try {
      let response = await fetch(`${apiUrl}/marketplace/cata`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });
      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchCataBalanceFailed,
          payload: 'Error while fetching CATA',
        });
      }
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchCataBalanceSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({
        type: actionDescriptors.fetchCataBalanceFailed,
        payload: 'Error while fetching CATA',
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchCataBalanceFailed,
        payload: 'Error while fetching CATA',
      });
    }
  },
  fetchUsdstAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchUsdstAddress });
    try {
      let response = await fetch(`${apiUrl}/marketplace/usdst/address`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchUsdstAddressFailed,
          payload: 'Error while fetching USDST address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUsdstAddressSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchUsdstAddressFailed,
        payload: 'Error while fetching USDST address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUsdstAddressFailed,
        payload: 'Error while fetching USDST address',
      });
      return null;
    }
  },
  fetchAssetsWithEighteenDecimalPlaces: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchAssetsWithEighteenDecimalPlaces });
    try {
      let response = await fetch(`${apiUrl}/marketplace/18DecimalPlaces`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchAssetsWithEighteenDecimalPlacesFailed,
          payload: 'Error while fetching asset addresses',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchAssetsWithEighteenDecimalPlacesSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchAssetsWithEighteenDecimalPlacesFailed,
        payload: 'Error while fetching asset addresses',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchAssetsWithEighteenDecimalPlacesFailed,
        payload: 'Error while fetching asset addresses',
      });
      return null;
    }
  },
  fetchCataAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchCataAddress });
    try {
      let response = await fetch(`${apiUrl}/marketplace/cata/address`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchCataAddressFailed,
          payload: 'Error while fetching CATA address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchCataAddressSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchCataAddressFailed,
        payload: 'Error while fetching CATA address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchCataAddressFailed,
        payload: 'Error while fetching CATA address',
      });
      return null;
    }
  },
  fetchUsdstTransactionHistory: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchUsdstTransactionHistory });
    try {
      let response = await fetch(`${apiUrl}/marketplace/usdst/history`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });
      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchUsdstTransactionHistoryFailed,
          payload: 'Error while fetching USDST Transaction History',
        });
        window.location.href = body.error.loginUrl;
      }
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUsdstTransactionHistorySuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({
        type: actionDescriptors.fetchUsdstTransactionHistoryFailed,
        payload: 'Error while fetching USDST Transaction History',
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUsdstTransactionHistoryFailed,
        payload: 'Error while fetching USDST Transaction History',
      });
    }
  },
  transferUsdst: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferUsdst });
    try {
      let response = await fetch(`${apiUrl}/marketplace/usdst/transfer`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.transferUsdstSuccessful,
        });
        actions.setMessage(dispatch, 'USDST transferred successfully', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.transferUsdstFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.transferUsdstFailed,
          error: 'Error while transferring Item',
        });
        actions.setMessage(dispatch, 'Error while transferring Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.transferUsdstFailed,
          error: 'Unauthorized while transferring USDST',
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.transferUsdstFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.transferUsdstFailed,
        error: 'Error while transferring USDST',
      });
      actions.setMessage(dispatch, 'Error while transferring USDST');
    }
  },
};

export { actionDescriptors, actions };
