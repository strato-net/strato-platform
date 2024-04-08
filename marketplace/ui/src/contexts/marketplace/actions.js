import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  fetchMarketplace: "fetch_marketplace",
  fetchMarketplaceSuccessful: "fetch_marketplace_successful",
  fetchMarketplaceFailed: "fetch_marketplace_failed",
  fetchMarketplaceLoggedIn: "fetch_marketplace_logged_in",
  fetchMarketplaceLoggedInSuccessful: "fetch_marketplace_logged_in_successful",
  fetchMarketplaceLoggedInFailed: "fetch_marketplace_logged_in_failed",
  fetchTopSellingProducts: "fetch_top_selling_products",
  fetchTopSellingProductsSuccessful: "fetch_top_selling_products_successful",
  fetchTopSellingProductsFailed: "fetch_top_selling_products_failed",
  fetchTopSellingProductsLoggedIn: "fetch_top_selling_products_logged_in",
  fetchTopSellingProductsLoggedInSuccessful: "fetch_top_selling_products_logged_in_successful",
  fetchTopSellingProductsLoggedInFailed: "fetch_top_selling_products_logged_in_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  addItemToCart: "add_item_to_cart",
  addItemToCartSuccessful: "add_item_to_cart_successful",
  addItemToCartFailed: "add_item_to_cart_failed",
  fetchCartItems: "fetch_cart_items",
  fetchCartItemsSuccessful: "fetch_cart_items_successful",
  fetchCartItemsFailed: "fetch_cart_items_failed",
  addItemToConfirmOrder: "add_item_to_confirm_order",
  addItemToConfirmOrderSuccessful: "add_item_to_confirm_order_successful",
  addItemToConfirmOrderFailed: "add_item_to_confirm_order_failed",
  fetchConfirmOrderItems: "fetch_confirm_order_items",
  fetchConfirmOrderItemsSuccessful: "fetch_confirm_order_items_successful",
  fetchConfirmOrderItemsFailed: "fetch_confirm_order_items_failed",
  deleteCartItem: "delete_cart_item",
  deleteCartItemSuccesful: "delete_cart_item_successful",
  deleteCartItemFailed: "delete_cart_item_failed",
  addShippingAddress: "add_shipping_address",
  addShippingAddressSuccessful: "add_shipping_address_successful",
  addShippingAddressFailed: "add_shipping_address_failed",
  fetchUserAddress: "fetch_user_address",
  fetchUserAddressSuccessful: "fetch_user_address_successful",
  fetchUserAddressFailed: "fetch_user_address_failed",
  fetchUserAddresses: "fetch_user_addresses",
  fetchUserAddressesSuccessful: "fetch_user_addresses_successful",
  fetchUserAddressesFailed: "fetch_user_addresses_failed",
  fetchStratsBalance: "fetch_strats_balance",
  fetchStratsBalanceSuccessful: "fetch_strats_balance_successful",
  fetchStratsBalanceFailed: "fetch_strats_balance_failed",
  fetchPriceHistory: "fetch_price_history",
  fetchPriceHistorySuccessful: "fetch_price_history_successful",
  fetchPriceHistoryFailed: "fetch_price_history_failed"  
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
      window.localStorage.setItem("cartList", JSON.stringify(cartList));
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
      window.localStorage.setItem("cartList", JSON.stringify(cartList));
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
      window.localStorage.setItem("confirmOrderList", JSON.stringify(cartList));
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
    // products,
    // manufacturers,
    minPrice,
    maxPrice,
    search,
    availabilityQuery
  ) => {
    dispatch({ type: actionDescriptors.fetchMarketplace });

    const categoryQuery = categorys ? `&category[]=${categorys}` : "";

    const subCategoryQuery = subCategorys
      ? `&subCategory[]=${subCategorys}`
      : "";

    // const manufacturerQuery = manufacturers
    //   ? `&manufacturer[]=${manufacturers}`
    //   : "";

    // const productIdQuery = products ? `&name[]=${products}` : "";
    const searchQuery = search
      ? `&queryValue=${search}&queryFields=name`
      : "";
    const priceQuery = `&range[]=price,${minPrice},${maxPrice}`;
    // const sortLatest = "&order=createdDate.desc"

    try {
      const response = await fetch(
        `${apiUrl}/marketplace?${priceQuery}${categoryQuery}${subCategoryQuery}${searchQuery}${availabilityQuery}`,
        {
          method: HTTP_METHODS.GET,
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
          error: "Error while fetching marketplace products",
        });
      }

      dispatch({
        type: actionDescriptors.fetchMarketplaceFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchMarketplaceFailed,
        error: "Error while fetching marketplace products",
      });
    }
  },

  fetchMarketplaceLoggedIn: async (
    dispatch,
    categorys,
    subCategorys,
    // products,
    // manufacturers,
    minPrice,
    maxPrice,
    search,
    availabilityQuery
  ) => {
    dispatch({ type: actionDescriptors.fetchMarketplaceLoggedIn });

    const categoryQuery = categorys ? `&category[]=${categorys}` : "";

    const subCategoryQuery = subCategorys
      ? `&subCategory[]=${subCategorys}`
      : "";

    // const manufacturerQuery = manufacturers
    //   ? `&manufacturer[]=${manufacturers}`
    //   : "";

    // const productIdQuery = products ? `&name[]=${products}` : "";
    const priceQuery = `&range[]=price,${minPrice},${maxPrice}`;
    // const sortLatest = "&order=createdDate.desc"
    const searchQuery = search
      ? `&queryValue=${search}&queryFields=name`
      : "";

    try {
      const response = await fetch(
        `${apiUrl}/marketplace/all?${priceQuery}${categoryQuery}${subCategoryQuery}${searchQuery}${availabilityQuery}`,
        {
          method: HTTP_METHODS.GET,
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
          error: "Error while fetching marketplace products",
        });
      }


      dispatch({
        type: actionDescriptors.fetchMarketplaceLoggedInFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchMarketplaceLoggedInFailed,
        error: "Error while fetching marketplace products",
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

  addShippingAddress: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.addShippingAddress });
    try {
      const response = await fetch(`${apiUrl}/order/userAddress`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.addShippingAddressSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Address added successfully", true);
        return body.data;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.addShippingAddressFailed,
          error: "Error while adding Shipping address",
        });
        actions.setMessage(dispatch, "Error while adding Shipping address");
        return null;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.addShippingAddressFailed,
          error: "Unauthorized while adding Shipping address"
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
        error: "Error while adding Shipping address",
      });
      actions.setMessage(dispatch, "Error while adding Shipping address");
    }
  },

  fetchUserAddress: async (dispatch, addressId) => {
    dispatch({ type: actionDescriptors.fetchUserAddress });

    try {
      const response = await fetch(
        `${apiUrl}/order/userAddress/${addressId}`,
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
          error: "Error while getting Shipping address",
        });
        actions.setMessage(dispatch, "Error while getting Shipping address");
        return false;
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
      actions.setMessage(dispatch, "Error while getting Shipping address");
    }
  },

  fetchUserAddresses: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchUserAddresses });

    try {
      const response = await fetch(
        `${apiUrl}/order/userAddresses/user`,
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
          error: "Error while getting Shipping address",
        });
        actions.setMessage(dispatch, "Error while getting Shipping address");
        return false;
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
      actions.setMessage(dispatch, "Error while getting Shipping address");
    }
  },
  fetchStratsBalance: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchStratsBalance });
    try {
      let response = await fetch(`${apiUrl}/marketplace/strats`, {
        method: HTTP_METHODS.GET,
        credentials: "same-origin",
      });
      const body = await response.json();
      if (response.status === RestStatus.UNAUTHORIZED || response.status === RestStatus.FORBIDDEN) {
        dispatch({
          type: actionDescriptors.fetchStratsBalanceFailed,
          payload: "Error while fetching STRATS",
        });
        return;
      }
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchStratsBalanceSuccessful,
          payload: body.data
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchStratsBalanceFailed, payload: "Error while fetching STRATS" });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchStratsBalanceFailed, payload: "Error while fetching STRATS" });
    }
  },

  fetchPriceHistory: async (dispatch, assetAddress, limit, offset) => {
    dispatch({ type: actionDescriptors.fetchPriceHistory });
    try {
      const query = assetAddress ? `&assetToBeSold=${encodeURIComponent(assetAddress)}` : ``;
      let response = await fetch(`${apiUrl}/marketplace/price/history?${query}&offset=${offset}&limit=${limit}`, {
        method: HTTP_METHODS.GET,
        credentials: "same-origin",
      });
      const body = await response.json();
      if (response.status === RestStatus.UNAUTHORIZED || response.status === RestStatus.FORBIDDEN) {
        dispatch({
          type: actionDescriptors.fetchPriceHistoryFailed,
          payload: "Error while fetching price history",
        });
        return;
      }
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchPriceHistorySuccessful,
          payload: body.data
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchPriceHistoryFailed, payload: "Error while fetching price history" });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchPriceHistoryFailed, payload: "Error while fetching price history" });
    }
  }


};

export { actionDescriptors, actions };