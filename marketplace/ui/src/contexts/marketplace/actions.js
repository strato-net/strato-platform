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
  fetchUSDSTBalance: 'fetch_USDST_balance',
  fetchUSDSTBalanceSuccessful: 'fetch_USDST_balance_successful',
  fetchUSDSTBalanceFailed: 'fetch_USDST_balance_failed',
  fetchCataBalance: 'fetch_cata_balance',
  fetchCataBalanceSuccessful: 'fetch_cata_balance_successful',
  fetchCataBalanceFailed: 'fetch_cata_balance_failed',
  fetchUSDSTAddress: 'fetch_USDST_address',
  fetchUSDSTAddressSuccessful: 'fetch_USDST_address_successful',
  fetchUSDSTAddressFailed: 'fetch_USDST_address_failed',
  fetchStratsAddress: 'fetch_strats_address',
  fetchStratsAddressSuccessful: 'fetch_strats_address_successful',
  fetchStratsAddressFailed: 'fetch_strats_address_failed',
  fetchAssetsWithEighteenDecimalPlaces: 'fetch_assets_with_eighteen_decimal_places',
  fetchAssetsWithEighteenDecimalPlacesSuccessful: 'fetch_assets_with_eighteen_decimal_places_successful',
  fetchAssetsWithEighteenDecimalPlacesFailed: 'fetch_assets_with_eighteen_decimal_places_failed',
  fetchCataAddress: 'fetch_cata_address',
  fetchCataAddressSuccessful: 'fetch_cata_address_successful',
  fetchCataAddressFailed: 'fetch_cata_address_failed',
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
  fetchUSDSTBalance: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchUSDSTBalance });
    try {
      let response = await fetch(`${apiUrl}/marketplace/USDST`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });
      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchUSDSTBalanceFailed,
          payload: 'Error while fetching USDST',
        });
      }
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUSDSTBalanceSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({
        type: actionDescriptors.fetchUSDSTBalanceFailed,
        payload: 'Error while fetching USDST',
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUSDSTBalanceFailed,
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
  fetchUSDSTAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchUSDSTAddress });
    try {
      let response = await fetch(`${apiUrl}/marketplace/USDST/address`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchUSDSTAddressFailed,
          payload: 'Error while fetching USDST address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUSDSTAddressSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchUSDSTAddressFailed,
        payload: 'Error while fetching USDST address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUSDSTAddressFailed,
        payload: 'Error while fetching USDST address',
      });
      return null;
    }
  },
  fetchStratsAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchStratsAddress });
    try {
      let response = await fetch(`${apiUrl}/marketplace/strats/address`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });
      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchStratsAddressFailed,
          payload: 'Error while fetching STRATS address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchStratsAddressSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchStratsAddressFailed,
        payload: 'Error while fetching STRATS address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchStratsAddressFailed,
        payload: 'Error while fetching STRATS address',
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
};

export { actionDescriptors, actions };
