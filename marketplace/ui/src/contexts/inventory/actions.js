import RestStatus from "http-status-codes";
import { apiUrl, fileServerUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createInventory: "create_inventory",
  createInventorySuccessful: "create_inventory_successful",
  createInventoryFailed: "create_inventory_failed",
  fetchInventory: "fetch_inventories",
  fetchInventorySuccessful: "fetch_inventory_successful",
  fetchInventoryFailed: "fetch_inventory_failed",
  fetchInventorySearch: "fetch_inventory_search",
  fetchInventorySearchSuccessful: "fetch_inventory_search_successful",
  fetchInventorySearchFailed: "fetch_inventory_search_failed",
  fetchInventoryDetail: "fetch_inventory_detail",
  fetchInventoryDetailSuccessful: "fetch_inventory_detail_successful",
  fetchInventoryDetailFailed: "fetch_inventory_detail_failed",
  fetchInventoryOwnershipHistory: "fetch_inventory_ownership_history",
  fetchInventoryOwnershipHistorySuccessful: "fetch_inventory_ownership_history_successful",
  fetchInventoryOwnershipHistoryFailed: "fetch_inventory_ownership_history_failed",
  updateInventory: "update_inventory",
  updateInventorySuccessful: "update_inventory_successful",
  updateInventoryFailed: "update_inventory_failed",
  updateSale: "update_sale",
  updateSaleSuccessful: "update_sale_successful",
  updateSaleFailed: "update_sale_failed",
  listInventory: "list_inventory",
  listInventorySuccessful: "list_inventory_successful",
  listInventoryFailed: "list_inventory_failed",
  unlistInventory: "unlist_inventory",
  unlistInventorySuccessful: "unlist_inventory_successful",
  unlistInventoryFailed: "unlist_inventory_failed",
  resellInventory: "resell_inventory",
  resellInventorySuccessful: "resell_inventory_successful",
  resellInventoryFailed: "resell_inventory_failed",
  transferInventory: "transfer_inventory",
  transferInventorySuccessful: "transfer_inventory_successful",
  transferInventoryFailed: "transfer_inventory_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  onboardSellerToStripe: "onboard_seller_to_stripe",
  onboardSellerToStripeSuccessful: "onboard_seller_to_stripe_successful",
  onboardSellerToStripeFailed: "onboard_seller_to_stripe_failed",
  sellerStripeStatus: "seller_stripe_status",
  sellerStripeStatusSuccessful: "seller_stripe_status_successful",
  sellerStripeStatusFailed: "seller_stripe_status_failed",
  uploadImage: "upload_image",
  uploadImageSuccessful: "upload_image_successful",
  uploadImageFailed: "upload_image_failed",
  createItem: "create_item",
  createItemSuccessful: "create_item_successful",
  createItemFailed: "create_item_failed",
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  createInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory`, {
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
          type: actionDescriptors.createInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Inventory created successfully", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.createInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.createInventoryFailed, error: "Error while creating Inventory" });
        actions.setMessage(dispatch, "Error while creating Inventory")
        return false;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.createInventoryFailed, 
          error: "Unauthorized while creating Inventory" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.createInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createInventoryFailed,
        error: "Error while creating Inventory",
      });
      actions.setMessage(dispatch, "Error while creating Inventory");
    }
  },

  fetchInventorySearch: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue
    ? `&queryValue=${queryValue}&queryFields=name`
    : "";

    dispatch({ type: actionDescriptors.fetchInventorySearch });

    try {
      const response = await fetch(
        `${apiUrl}/inventory?limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchInventorySearchSuccessful,
          payload: {data: body.data.inventoriesWithImageUrl, count: body.data.count}
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchInventorySearchFailed,
          error: "Error while fetching Inventory",
        });
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.fetchInventorySearchFailed, 
          error: "Unauthorized while fetching Inventory" 
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.fetchInventorySearchFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchInventorySearchFailed,
        error: "Error while fetching Inventory",
      });
    }
  },

  fetchInventory: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue ? `&productId=${queryValue}` : "";

    dispatch({ type: actionDescriptors.fetchInventory });

    try {
      const response = await fetch(
        `${apiUrl}/inventory?limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchInventorySuccessful,
          payload: {data: body.data.inventoriesWithImageUrl, count: body.data.count},
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchInventoryFailed,
          error: "Error while fetching Inventory",
        });
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.fetchInventoryFailed, 
          error: "Unauthorized while fetching Inventory" 
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.fetchInventoryFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchInventoryFailed,
        error: "Error while fetching Inventory",
      });
    }
  },

  updateInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/update`, {
        method: HTTP_METHODS.PUT,
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
          type: actionDescriptors.updateInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Inventory has been updated", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateInventoryFailed,
          error: "Error while updating Inventory",
        });
        actions.setMessage(dispatch, "Error while updating Inventory");
        return false;;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.updateInventoryFailed, 
          error: "Unauthorized while updating Inventory" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, "Error while updating Inventory");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateInventoryFailed,
        error: "Error while updating Inventory",
      });
      actions.setMessage(dispatch, "Error while updating Inventory");
    }
  },

  updateSale: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateSale });

    try {
      const response = await fetch(`${apiUrl}/inventory/updateSale`, {
        method: HTTP_METHODS.PUT,
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
          type: actionDescriptors.updateSaleSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Sale has been updated", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateSaleFailed,
          error: "Error while updating Sale",
        });
        actions.setMessage(dispatch, "Error while updating Sale");
        return false;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.updateSaleFailed, 
          error: "Unauthorized while updating Sale" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateSaleFailed,
        error: body.error
      });
      actions.setMessage(dispatch, "Error while updating Sale");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateSaleFailed,
        error: "Error while updating Sale",
      });
      actions.setMessage(dispatch, "Error while updating Sale");
    }
  },

  listInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.listInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/list`, {
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
          type: actionDescriptors.listInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Listing Item was successful", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.listInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.listInventoryFailed, error: "Error while listing Item" });
        actions.setMessage(dispatch, "Error while listing Item")
        return false;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.listInventoryFailed, 
          error: "Unauthorized while listing Inventory" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.listInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.listInventoryFailed,
        error: "Error while listing Item",
      });
      actions.setMessage(dispatch, "Error while listing Item");
    }
  },

  unlistInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.unlistInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/unlist`, {
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
          type: actionDescriptors.unlistInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Unlisting Item was successful", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.unlistInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.unlistInventoryFailed, error: "Error while unlisting Item" });
        actions.setMessage(dispatch, "Error while unlisting Item")
        return false;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.unlistInventoryFailed, 
          error: "Unauthorized while unlisting Inventory" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.unlistInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.unlistInventoryFailed,
        error: "Error while unlisting Item",
      });
      actions.setMessage(dispatch, "Error while unlisting Item");
    }
  },

  resellInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.resellInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/resell`, {
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
          type: actionDescriptors.resellInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Inventory has been updated", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.resellInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.resellInventoryFailed, error: "Error while publishing Item" });
        actions.setMessage(dispatch, "Error while publishing Item")
        return false;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.resellInventoryFailed, 
          error: "Unauthorized while publishing Inventory" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.resellInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.resellInventoryFailed,
        error: "Error while publishing Item",
      });
      actions.setMessage(dispatch, "Error while publishing Item");
    }
  },

  transferInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/transfer`, {
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
          type: actionDescriptors.transferInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Inventory has been transferred", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.transferInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.transferInventoryFailed, error: "Error while transferring Item" });
        actions.setMessage(dispatch, "Error while transferring Item")
        return false;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.transferInventoryFailed, 
          error: "Unauthorized while transferring Inventory" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.transferInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.transferInventoryFailed,
        error: "Error while transferring Item",
      });
      actions.setMessage(dispatch, "Error while transferring Item");
    }
  },

  fetchInventoryDetail: async (dispatch, address) => {
    dispatch({ type: actionDescriptors.fetchInventoryDetail });

    try {
      const response = await fetch(`${apiUrl}/inventory/${address}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchInventoryDetailSuccessful,
          payload: body.data,
        });

        return true;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.fetchInventoryDetailFailed, 
          error: "Unauthorized while fetching Inventory" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchInventoryDetailFailed,
        error: "Error while fetching Inventory",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchInventoryDetailFailed,
        error: "Error while fetching Inventory",
      });
    }
  },

  fetchInventoryOwnershipHistory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.fetchInventoryOwnershipHistory });

    try {
      const {
        contract_name,
        originAddress,
        minItemNumber,
        maxItemNumber
      } = payload
      const queryStr = `?contract_name=${contract_name}&originAddress=${originAddress}&minItemNumber=${minItemNumber}&maxItemNumber=${maxItemNumber}`
      const response = await fetch(`${apiUrl}/inventory/ownership/history${queryStr}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchInventoryOwnershipHistorySuccessful,
          payload: body.data,
        });

        return true;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.fetchInventoryOwnershipHistoryFailed, 
          error: "Unauthorized while fetching ownership history" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchInventoryOwnershipHistoryFailed,
        error: "Error while fetching ownership history",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchInventoryOwnershipHistoryFailed,
        error: "Error while fetching ownership history",
      });
      return false;
    }
  },

  onboardSellerToStripe: async (dispatch) => {
    dispatch({ type: actionDescriptors.onboardSellerToStripe });

    try {
      const response = await fetch(`${apiUrl}/payment/stripe/account`, {
        // const response = await fetch(`${apiUrl}/inventory`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.onboardSellerToStripeSuccessful,
          payload: body.data,
        });
        return body.data;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.onboardSellerToStripeFailed,
          error: "Error while trying to onboard to Stripe",
        });
        actions.setMessage(dispatch, "Error while trying to onboard to Stripe");
        return null;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.onboardSellerToStripeFailed, 
          error: "Unauthorized while trying to onboard to Stripe" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.onboardSellerToStripeFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.onboardSellerToStripeFailed,
        error: "Error while trying to onboard to Stripe",
      });
    }
  },

  sellerStripeStatus: async (dispatch, username) => {
    dispatch({ type: actionDescriptors.sellerStripeStatus });

    try {
      const response = await fetch(`${apiUrl}/payment/stripe/account/status/${username}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.sellerStripeStatusSuccessful,
          payload: body.data,
        });
        return body.data;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.sellerStripeStatusFailed, 
          error: "Unauthorized while trying to get Stripe status" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.sellerStripeStatusFailed,
        error: "Error while trying to get Stripe status",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.sellerStripeStatusFailed,
        error: "Error while trying to get Stripe status",
      });
    }
  },

  uploadImage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.uploadImage });

    try {
      let response
      try {
        response = await fetch(fileServerUrl, {
          method: HTTP_METHODS.POST,
          body: payload,
        });
      } catch(e) {
        console.log(JSON.stringify(e))
      }

      const body = await response.text();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.uploadImageSuccessful,
          payload: body,
        });
        // actions.setMessage(dispatch, "Image uploaded successfully", true);
        return body;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.uploadImageFailed,
          error: "Image upload failed",
        });
        actions.setMessage(dispatch, "Error while uploading Image");
        return false;
      }

      dispatch({
        type: actionDescriptors.uploadImageFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.uploadImageFailed,
        error: "Image upload failed",
      });
      actions.setMessage(dispatch, "Error while uploading Image");
    }
  },

  createItem: async (dispatch, payload, category) => {
    dispatch({ type: actionDescriptors.createItem });

    try {
      const response = await fetch(`${apiUrl}/${category}`, {
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
          type: actionDescriptors.createItemSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Item created successfully", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.createItemFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.createItemFailed, error: "Error while creating Item" });
        actions.setMessage(dispatch, "Error while creating Item")
        return false;
      }

      dispatch({
        type: actionDescriptors.createItemFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createItemFailed,
        error: "Error while creating Item",
      });
      actions.setMessage(dispatch, "Error while creating Item");
    }
  }

};

export { actionDescriptors, actions };
