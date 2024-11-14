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
//------------------------------------------------------------
  stakeInventory: "stake_inventory", 
  stakeInventorySuccessful: "stake_inventory_successful",
  stakeInventoryFailed: "stake_inventory_failed",

  unstakeInventory: "unstake_inventory", 
  unstakeInventorySuccessful: "unstake_inventory_successful",
  unstakeInventoryFailed: "unstake_inventory_failed",

  getGovernanceAddress: "get_governance_address",
  getGovernanceAddressSuccessful: "get_governance_address_successful",
  getGovernanceAddressFailed: "get_governance_address_failed",

  getCalculatedValue: "get_calculated_value",
  getCalculatedValueSuccessful: "get_calculated_value_successful",
  getCalculatedValueFailed: "get_calculated_value_failed",
//------------------------------------------------------------
  resellInventory: "resell_inventory",
  resellInventorySuccessful: "resell_inventory_successful",
  resellInventoryFailed: "resell_inventory_failed",
  transferInventory: "transfer_inventory",
  transferInventorySuccessful: "transfer_inventory_successful",
  transferInventoryFailed: "transfer_inventory_failed",
  fetchSupportedTokens: "fetch_supported_tokens",
  fetchSupportedTokensSuccessful: "fetch_supported_tokens_successful",
  fetchSupportedTokensFailed: "fetch_supported_tokens_failed",
  bridgeInventory: "bridge_inventory",
  bridgeInventorySuccessful: "bridge_inventory_successful",
  bridgeInventoryFailed: "bridge_inventory_failed",
  fetchItemTransfers: "fetch_item_transfers",
  fetchItemTransfersSuccessful: "fetch_item_transfers_successful",
  fetchItemTransfersFailed: "fetch_item_transfers_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  uploadImage: "upload_image",
  uploadImageSuccessful: "upload_image_successful",
  uploadImageFailed: "upload_image_failed",
  createItem: "create_item",
  createItemSuccessful: "create_item_successful",
  createItemFailed: "create_item_failed",
  fetchInventoryForUser: "fetch_inventory_user_profile",
  fetchInventoryForUserSuccessful: "fetch_inventory_user_profile_success",
  fetchInventoryForUserFailed: "fetch_inventory_user_profile_failed",
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
        actions.setMessage(dispatch, "Item created successfully", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.createInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.createInventoryFailed, error: "Error while creating Item" });
        actions.setMessage(dispatch, "Error while creating Item")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createInventoryFailed,
          error: "Unauthorized while creating Item"
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
        error: "Error while creating Item",
      });
      actions.setMessage(dispatch, "Error while creating Item");
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
          payload: { data: body.data.inventoriesWithImageUrl, count: body.data.count }
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchInventorySearchFailed,
          error: "Error while fetching Item",
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchInventorySearchFailed,
          error: "Unauthorized while fetching Item"
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
        error: "Error while fetching Item",
      });
    }
  },

  fetchInventory: async (dispatch, limit, offset, queryValue, category) => {
    const query = queryValue
    ? `&queryValue=${queryValue}&queryFields=name`
    : "";
    
    const categoryQuery = category ? `category[]=${category}` : "";

    dispatch({ type: actionDescriptors.fetchInventory });

    try {
      const response = await fetch(
        `${apiUrl}/inventory?${categoryQuery}&limit=${limit}&offset=${offset}${query}&isMint=true`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchInventorySuccessful,
          payload: { data: body.data.inventoriesWithImageUrl, count: body.data.count },
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchInventoryFailed,
          error: "Error while fetching Item",
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchInventoryFailed,
          error: "Unauthorized while fetching Item"
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
        error: "Error while fetching Item",
      });
    }
  },

  fetchInventoryForUser: async (dispatch, limit, offset, queryValue, category) => {
    const query = queryValue
    ? `&queryValue=${queryValue}&queryFields=name`
    : "";

    const categoryQuery = category ? `category[]=${category}` : "";

    dispatch({ type: actionDescriptors.fetchInventoryForUser });

    try {
      const response = await fetch(
        `${apiUrl}/inventory/user/inventories?${categoryQuery}&limit=${limit}&offset=${offset}${query}&isMint=true`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchInventoryForUserSuccessful,
          payload: { data: body.data.inventoriesWithImageUrl, count: body.data.count },
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchInventoryForUserFailed,
          error: "Error while fetching Item",
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchInventoryForUserFailed,
          error: "Unauthorized while fetching Item"
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.fetchInventoryForUserFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchInventoryForUserFailed,
        error: "Error while fetching Item",
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
        actions.setMessage(dispatch, "Item has been updated", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateInventoryFailed,
          error: "Error while updating Item",
        });
        actions.setMessage(dispatch, "Error while updating Item");
        return false;;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.updateInventoryFailed,
          error: "Unauthorized while updating Item"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, "Error while updating Item");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateInventoryFailed,
        error: "Error while updating Item",
      });
      actions.setMessage(dispatch, "Error while updating Item");
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
        actions.setMessage(dispatch, "Listing updated successfully", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateSaleFailed,
          error: "Error while updating listing",
        });
        actions.setMessage(dispatch, "Error while updating listing");
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.updateSaleFailed,
          error: "Error while updating listing"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateSaleFailed,
        error: body.error
      });
      actions.setMessage(dispatch, "Error while updating listing");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateSaleFailed,
        error: "Error while updating listing",
      });
      actions.setMessage(dispatch, "Error while updating listing");
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
        actions.setMessage(dispatch, "Item listed successfully", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.listInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.listInventoryFailed, error: "Error while listing Item" });
        actions.setMessage(dispatch, "Error while listing Item")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.listInventoryFailed,
          error: "Unauthorized while listing Item"
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
        actions.setMessage(dispatch, "Item unlisted successfully", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.unlistInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.unlistInventoryFailed, error: "Error while unlisting Item" });
        actions.setMessage(dispatch, "Error while unlisting Item")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.unlistInventoryFailed,
          error: "Unauthorized while unlisting Item"
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
        actions.setMessage(dispatch, "Item has been updated", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.resellInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.resellInventoryFailed, error: "Error while publishing Item" });
        actions.setMessage(dispatch, "Error while publishing Item")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.resellInventoryFailed,
          error: "Unauthorized while publishing Item"
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
  
  fetchSupportedTokens: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchSupportedTokens });
  
    try {
      const response = await fetch(`${apiUrl}/inventory/supportedTokens`, {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
  
      const body = await response.json();
  
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSupportedTokensSuccessful,
          payload: body.data,
        });
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.fetchSupportedTokensFailed, error: body.error.message });
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.fetchSupportedTokensFailed, error: "Error while fetching supported tokens" });
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchSupportedTokensFailed,
          error: "Unauthorized while fetching supported tokens"
        });
        window.location.href = body.error.loginUrl;
        return false;
      }
  
      dispatch({
        type: actionDescriptors.fetchSupportedTokensFailed,
        error: body.error,
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchSupportedTokensFailed,
        error: "Error while fetching supported tokens",
      });
      return false;
    }
  },
  
  bridgeInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.bridgeInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/bridge`, {
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
          type: actionDescriptors.bridgeInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Item has been bridged", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.bridgeInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.bridgeInventoryFailed, error: "Error while bridging Item" });
        actions.setMessage(dispatch, "Error while bridging Item")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.bridgeInventoryFailed,
          error: "Unauthorized while bridging Item"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.bridgeInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.bridgeInventoryFailed,
        error: "Error while bridging Item",
      });
      actions.setMessage(dispatch, "Error while bridging Item");
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
        dispatch({ type: actionDescriptors.transferInventorySuccessful });
        actions.setMessage(dispatch, "Item has been transferred", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.transferInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.transferInventoryFailed, error: "Error while transferring Item" });
        actions.setMessage(dispatch, "Error while transferring Item")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.transferInventoryFailed,
          error: "Unauthorized while transferring Item"
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
// ------------------------------------------------------------------------------------------------------------------------------------------
  stakeInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.stakeInventory });

    try {
      const response = await fetch(`${apiUrl}/governance/stake`, {
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
          type: actionDescriptors.stakeInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Item has been Staked Successfully", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.stakeInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.stakeInventoryFailed, error: "Error while Staking Item" });
        actions.setMessage(dispatch, "Error while Staking Item")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.stakeInventoryFailed,
          error: "Unauthorized while Staking Item"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.stakeInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.stakeInventoryFailed,
        error: "Error while Staking Item",
      });
      actions.setMessage(dispatch, "Error while Staking Item");
    }
  },

  UnstakeInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.unstakeInventory });

    try {
      const response = await fetch(`${apiUrl}/governance/unstake`, {
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
          type: actionDescriptors.unstakeInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Item has been Unstaked", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.unstakeInventoryFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.unstakeInventoryFailed, error: "Error while Unstaking Item" });
        actions.setMessage(dispatch, "Error while Unstaking Item")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.unstakeInventoryFailed,
          error: "Unauthorized while Unstaking Item"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.unstakeInventoryFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.unstakeInventoryFailed,
        error: "Error while Unstaking Item",
      });
      actions.setMessage(dispatch, "Error while Unstaking Item");
    }
  },

  getGovernanceAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.getGovernanceAddress });

    try {
      const response = await fetch(`${apiUrl}/governance`, {
        method: HTTP_METHODS.GET,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.getGovernanceAddressSuccessful,
          payload: body.data,
        });
        // actions.setMessage(dispatch, "Item has been Staked Successfully", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.getGovernanceAddressFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.getGovernanceAddressFailed, error: "Error while fetching the governance Address" });
        actions.setMessage(dispatch, "Errorwhile fetching the governance Address")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getGovernanceAddressFailed,
          error: "Unauthorized while fetching the governance Address"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.getGovernanceAddressFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.getGovernanceAddressFailed,
        error: "Error while fetching the governance Address",
      });
      actions.setMessage(dispatch, "Error while fetching the governance Address");
    }
  },

  calculateValue: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.getCalculatedValue });

    try {
      const response = await fetch(`${apiUrl}/governance/calculate`, { //Stake
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
          type: actionDescriptors.getCalculatedValue,
          payload: body.data,
        });
        // actions.setMessage(dispatch, "Item has been Staked Successfully", true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({ type: actionDescriptors.getCalculatedValueFailed, error: body.error.message });
        actions.setMessage(dispatch, body.error.message)
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.getCalculatedValueFailed, error: "Error while fetching the calculated value" });
        actions.setMessage(dispatch, "Error while fetching the calculated value")
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getCalculatedValueFailed,
          error: "Unauthorized while fetching the calculated value"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.getCalculatedValueFailed,
        error: body.error
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.getCalculatedValueFailed,
        error: "Error while fetching the calculated value",
      });
      actions.setMessage(dispatch, "Error while fetching the calculated value");
    }
  },
// ------------------------------------------------------------------------------------------------------------------------------------------
  fetchItemTransfers: async (dispatch, limit, offset, ownerCommonName, order, date, search) => {
    dispatch({ type: actionDescriptors.fetchItemTransfers });

    try {
      let range;
      let searchQuery;
      const end = date + 86400;
      if (date) {
        range = `&range[]=transferDate,${date},${end}`
      }
      if (search) {
        const searchValue = isNaN(search) ? search : parseInt(search);
        if (!isNaN(searchValue)) {
          searchQuery = search ? `&transferNumber=${searchValue}` : '';
        } else {
          searchQuery = search ? `&queryValue=${searchValue}&queryFields=assetName` : '';
        }
      }
      let url = `${apiUrl}/inventory/transfers/items?limit=${limit}&order=transferDate.${order}&offset=${offset}&or=(oldOwnerCommonName.eq.${ownerCommonName},newOwnerCommonName.eq.${ownerCommonName})${search ? searchQuery : ''}${date ? range : ''}`

      const response = await fetch(url, {
        method: HTTP_METHODS.GET,

      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchItemTransfersSuccessful,
          payload: body.data,
        });

        return true;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchItemTransfersFailed,
          error: "Unauthorized while fetching Item transfers"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchItemTransfersFailed,
        error: "Error while fetching Item transfers",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchItemTransfersFailed,
        error: "Error while fetching Item transfers",
      });
      return false;
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
        error: "Error while fetching Item",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchInventoryDetailFailed,
        error: "Error while fetching Item",
      });
    }
  },

  fetchInventoryOwnershipHistory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.fetchInventoryOwnershipHistory });

    try {
      const {
        originAddress,
        minItemNumber,
        maxItemNumber
      } = payload
      const queryStr = `?originAddress=${originAddress}&minItemNumber=${minItemNumber}&maxItemNumber=${maxItemNumber}`
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
      } else if (response.status === RestStatus.UNAUTHORIZED) {
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

  uploadImage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.uploadImage });

    try {
      let response
      try {
        response = await fetch(fileServerUrl, {
          method: HTTP_METHODS.POST,
          body: payload,
        });
      } catch (e) {
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
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.uploadImageFailed,
          error: "Unauthorized while trying to upload image"
        });
        window.location.href = body.error.loginUrl;
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
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createItemFailed,
          error: "Unauthorized while trying to create Item"
        });
        window.location.href = body.error.loginUrl;
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
  },

  fetchPriceHistory: async (dispatch, assetAddress, limit, offset, timeFilter) => {
    dispatch({ type: actionDescriptors.fetchPriceHistory });
    try {
      const query = assetAddress ? `&assetToBeSold=${encodeURIComponent(assetAddress)}` : ``;
      let response = await fetch(`${apiUrl}/inventory/price/history?${query}&offset=${offset}&limit=${limit}&timeFilter=${timeFilter}`, {
        method: HTTP_METHODS.GET,
        credentials: "same-origin",
      });
      const body = await response.json();
      if (response.status === RestStatus.UNAUTHORIZED || response.status === RestStatus.FORBIDDEN) {
        dispatch({
          type: actionDescriptors.fetchPriceHistoryFailed,
          payload: "Error while fetching price history",
        });
        window.location.href = body.error.loginUrl;
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
