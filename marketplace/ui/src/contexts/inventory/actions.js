import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createInventory: "create_inventory",
  createInventorySuccessful: "create_inventory_successful",
  createInventoryFailed: "create_inventory_failed",
  fetchInventory: "fetch_inventories",
  fetchInventorySuccessful: "fetch_inventory_successful",
  fetchInventoryFailed: "fetch_inventory_failed",
  fetchInventoryDetail: "fetch_inventory_detail",
  fetchInventoryDetailSuccessful: "fetch_inventory_detail_successful",
  fetchInventoryDetailFailed: "fetch_inventory_detail_failed",
  updateInventory: "update_inventory",
  updateInventorySuccessful: "update_inventory_successful",
  updateInventoryFailed: "update_inventory_failed",
  resellInventory: "resell_inventory",
  resellInventorySuccessful: "resell_inventory_successful",
  resellInventoryFailed: "resell_inventory_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  onboardSellerToStripe: "onboard_seller_to_stripe",
  onboardSellerToStripeSuccessful: "onboard_seller_to_stripe_successful",
  onboardSellerToStripeFailed: "onboard_seller_to_stripe_failed",
  sellerStripeStatus: "seller_stripe_status",
  sellerStripeStatusSuccessful: "seller_stripe_status_successful",
  sellerStripeStatusFailed: "seller_stripe_status_failed"
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
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchInventoryFailed,
          error: "Error while fetching Inventory",
        });
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
        actions.setMessage(dispatch, "Inventory created successfully to resell", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.resellInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.resellInventoryFailed, error: "Error while reselling Inventory" });
        actions.setMessage(dispatch, "Error while reselling Inventory")
        return false;
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
        error: "Error while reselling Inventory",
      });
      actions.setMessage(dispatch, "Error while reselling Inventory");
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
          type: actionDescriptors.fetchInventoryFailed,
          error: "Error while trying to onboard to Stripe",
        });
        actions.setMessage(dispatch, "Error while trying to onboard to Stripe");
        return null;
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

  sellerStripeStatus: async (dispatch, org) => {
    dispatch({ type: actionDescriptors.sellerStripeStatus });

    try {
      const response = await fetch(`${apiUrl}/payment/stripe/account/status/${org}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.sellerStripeStatusSuccessful,
          payload: body.data,
        });
        return body.data;
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

};

export { actionDescriptors, actions };
