import RestStatus from 'http-status-codes';
import { apiUrl, fileServerUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  createInventory: 'create_inventory',
  createInventorySuccessful: 'create_inventory_successful',
  createInventoryFailed: 'create_inventory_failed',
  fetchInventory: 'fetch_inventories',
  fetchInventorySuccessful: 'fetch_inventory_successful',
  fetchInventoryFailed: 'fetch_inventory_failed',
  fetchInventorySearch: 'fetch_inventory_search',
  fetchInventorySearchSuccessful: 'fetch_inventory_search_successful',
  fetchInventorySearchFailed: 'fetch_inventory_search_failed',
  fetchInventoryDetail: 'fetch_inventory_detail',
  fetchInventoryDetailSuccessful: 'fetch_inventory_detail_successful',
  fetchInventoryDetailFailed: 'fetch_inventory_detail_failed',
  fetchInventoryOwnershipHistory: 'fetch_inventory_ownership_history',
  fetchInventoryOwnershipHistorySuccessful:
    'fetch_inventory_ownership_history_successful',
  fetchInventoryOwnershipHistoryFailed:
    'fetch_inventory_ownership_history_failed',
  updateInventory: 'update_inventory',
  updateInventorySuccessful: 'update_inventory_successful',
  updateInventoryFailed: 'update_inventory_failed',
  updateSale: 'update_sale',
  updateSaleSuccessful: 'update_sale_successful',
  updateSaleFailed: 'update_sale_failed',
  listInventory: 'list_inventory',
  listInventorySuccessful: 'list_inventory_successful',
  listInventoryFailed: 'list_inventory_failed',
  unlistInventory: 'unlist_inventory',
  unlistInventorySuccessful: 'unlist_inventory_successful',
  unlistInventoryFailed: 'unlist_inventory_failed',
  //------------------------------------------------------------
  stakeInventory: 'stake_inventory',
  stakeInventorySuccessful: 'stake_inventory_successful',
  stakeInventoryFailed: 'stake_inventory_failed',

  unstakeInventory: 'unstake_inventory',
  unstakeInventorySuccessful: 'unstake_inventory_successful',
  unstakeInventoryFailed: 'unstake_inventory_failed',

  getAllReserve: 'get_all_reserve_address',
  getAllReserveSuccessful: 'get_all_reserve_address_successful',
  getAllReserveFailed: 'get_all_reserve_address_failed',

  getReserve: 'get_reserve_address',
  getReserveSuccessful: 'get_reserve_address_successful',
  getReserveFailed: 'get_reserve_address_failed',

  getEscrowForAsset: 'get_escrow_for_asset',
  getEscrowForAssetSuccessful: 'get_escrow_for_asset_successful',
  getEscrowForAssetFailed: 'get_escrow_for_asset_failed',

  getUserCataRewards: 'get_user_cata_rewards',
  getUserCataRewardsSuccessful: 'get_user_cata_rewards_successful',
  getUserCataRewardsFailed: 'get_user_cata_rewards_failed',

  getOracle: 'get_oracle',
  getOracleSuccessful: 'get_oracle_successful',
  getOracleFailed: 'get_oracle_failed',

  borrow: 'borrow',
  borrowSuccessful: 'borrow_successful',
  borrowFailed: 'borrow_failed',

  repay: 'repay',
  repaySuccessful: 'repay_successful',
  repayFailed: 'repay_failed',

  //------------------------------------------------------------
  resellInventory: 'resell_inventory',
  resellInventorySuccessful: 'resell_inventory_successful',
  resellInventoryFailed: 'resell_inventory_failed',
  transferInventory: 'transfer_inventory',
  transferInventorySuccessful: 'transfer_inventory_successful',
  transferInventoryFailed: 'transfer_inventory_failed',
  fetchSupportedTokens: 'fetch_supported_tokens',
  fetchSupportedTokensSuccessful: 'fetch_supported_tokens_successful',
  fetchSupportedTokensFailed: 'fetch_supported_tokens_failed',
  bridgeInventory: 'bridge_inventory',
  bridgeInventorySuccessful: 'bridge_inventory_successful',
  bridgeInventoryFailed: 'bridge_inventory_failed',
  fetchItemTransfers: 'fetch_item_transfers',
  fetchItemTransfersSuccessful: 'fetch_item_transfers_successful',
  fetchItemTransfersFailed: 'fetch_item_transfers_failed',
  resetMessage: 'reset_message',
  setMessage: 'set_message',
  uploadImage: 'upload_image',
  uploadImageSuccessful: 'upload_image_successful',
  uploadImageFailed: 'upload_image_failed',
  createItem: 'create_item',
  createItemSuccessful: 'create_item_successful',
  createItemFailed: 'create_item_failed',
  fetchInventoryForUser: 'fetch_inventory_user_profile',
  fetchInventoryForUserSuccessful: 'fetch_inventory_user_profile_success',
  fetchInventoryForUserFailed: 'fetch_inventory_user_profile_failed',
  fetchPriceHistory: 'fetch_price_history',
  fetchPriceHistorySuccessful: 'fetch_price_history_successful',
  fetchPriceHistoryFailed: 'fetch_price_history_failed',
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
          type: actionDescriptors.createInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item created successfully', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.createInventoryFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.createInventoryFailed,
          error: 'Error while creating Item',
        });
        actions.setMessage(dispatch, 'Error while creating Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createInventoryFailed,
          error: 'Unauthorized while creating Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.createInventoryFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createInventoryFailed,
        error: 'Error while creating Item',
      });
      actions.setMessage(dispatch, 'Error while creating Item');
    }
  },

  fetchInventorySearch: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue
      ? `&queryValue=${queryValue}&queryFields=name`
      : '';

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
          payload: {
            data: body.data.inventoriesWithImageUrl,
            count: body.data.count,
          },
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchInventorySearchFailed,
          error: 'Error while fetching Item',
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchInventorySearchFailed,
          error: 'Unauthorized while fetching Item',
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
        error: 'Error while fetching Item',
      });
    }
  },

  fetchInventory: async (
    dispatch,
    limit,
    offset,
    queryValue,
    category,
    originAddress
  ) => {
    const query = queryValue
      ? `&queryValue=${queryValue}&queryFields=name`
      : '';

    const categoryQuery = category ? `category[]=${category}` : '';

    const originAddressQuery = originAddress
      ? `&originAddress[]=${originAddress}`
      : '';

    dispatch({ type: actionDescriptors.fetchInventory });

    try {
      const response = await fetch(
        `${apiUrl}/inventory?${categoryQuery}&limit=${limit}&offset=${offset}${query}${originAddressQuery}&isMint=true`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchInventorySuccessful,
          payload: {
            data: body.data.inventoriesWithImageUrl,
            count: body.data.count,
          },
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchInventoryFailed,
          error: 'Error while fetching Item',
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchInventoryFailed,
          error: 'Unauthorized while fetching Item',
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
        error: 'Error while fetching Item',
      });
    }
  },

  fetchInventoryForUser: async (
    dispatch,
    limit,
    offset,
    queryValue,
    category,
    originAddress,
    user
  ) => {
    const query = queryValue
      ? `&queryValue=${queryValue}&queryFields=name`
      : '';

    const categoryQuery = category ? `category[]=${category}` : '';
    const userName = user ? `&user=${user}` : '';

    const originAddressQuery = originAddress
      ? `&originAddress[]=${originAddress}`
      : '';

    dispatch({ type: actionDescriptors.fetchInventoryForUser });

    try {
      const response = await fetch(
        `${apiUrl}/inventory/user/inventories?${categoryQuery}&limit=${limit}&offset=${offset}${query}${originAddressQuery}&isMint=true${userName}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchInventoryForUserSuccessful,
          payload: {
            data: body.data.inventoriesWithImageUrl,
            count: body.data.count,
          },
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchInventoryForUserFailed,
          error: 'Error while fetching Item',
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchInventoryForUserFailed,
          error: 'Unauthorized while fetching Item',
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
        error: 'Error while fetching Item',
      });
    }
  },

  updateInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/update`, {
        method: HTTP_METHODS.PUT,
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
          type: actionDescriptors.updateInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item has been updated', true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateInventoryFailed,
          error: 'Error while updating Item',
        });
        actions.setMessage(dispatch, 'Error while updating Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.updateInventoryFailed,
          error: 'Unauthorized while updating Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateInventoryFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, 'Error while updating Item');
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateInventoryFailed,
        error: 'Error while updating Item',
      });
      actions.setMessage(dispatch, 'Error while updating Item');
    }
  },

  updateSale: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateSale });

    try {
      const response = await fetch(`${apiUrl}/inventory/updateSale`, {
        method: HTTP_METHODS.PUT,
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
          type: actionDescriptors.updateSaleSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Listing updated successfully', true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateSaleFailed,
          error: 'Error while updating listing',
        });
        actions.setMessage(dispatch, 'Error while updating listing');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.updateSaleFailed,
          error: 'Error while updating listing',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateSaleFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, 'Error while updating listing');
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateSaleFailed,
        error: 'Error while updating listing',
      });
      actions.setMessage(dispatch, 'Error while updating listing');
    }
  },

  listInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.listInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/list`, {
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
          type: actionDescriptors.listInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item listed successfully', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.listInventoryFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.listInventoryFailed,
          error: 'Error while listing Item',
        });
        actions.setMessage(dispatch, 'Error while listing Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.listInventoryFailed,
          error: 'Unauthorized while listing Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.listInventoryFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.listInventoryFailed,
        error: 'Error while listing Item',
      });
      actions.setMessage(dispatch, 'Error while listing Item');
    }
  },

  unlistInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.unlistInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/unlist`, {
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
          type: actionDescriptors.unlistInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item unlisted successfully', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.unlistInventoryFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.unlistInventoryFailed,
          error: 'Error while unlisting Item',
        });
        actions.setMessage(dispatch, 'Error while unlisting Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.unlistInventoryFailed,
          error: 'Unauthorized while unlisting Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.unlistInventoryFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.unlistInventoryFailed,
        error: 'Error while unlisting Item',
      });
      actions.setMessage(dispatch, 'Error while unlisting Item');
    }
  },

  resellInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.resellInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/resell`, {
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
          type: actionDescriptors.resellInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item has been updated', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.resellInventoryFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.resellInventoryFailed,
          error: 'Error while publishing Item',
        });
        actions.setMessage(dispatch, 'Error while publishing Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.resellInventoryFailed,
          error: 'Unauthorized while publishing Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.resellInventoryFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.resellInventoryFailed,
        error: 'Error while publishing Item',
      });
      actions.setMessage(dispatch, 'Error while publishing Item');
    }
  },

  fetchSupportedTokens: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchSupportedTokens });

    try {
      const response = await fetch(`${apiUrl}/inventory/supportedTokens`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
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
        dispatch({
          type: actionDescriptors.fetchSupportedTokensFailed,
          error: body.error.message,
        });
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchSupportedTokensFailed,
          error: 'Error while fetching supported tokens',
        });
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchSupportedTokensFailed,
          error: 'Unauthorized while fetching supported tokens',
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
        error: 'Error while fetching supported tokens',
      });
      return false;
    }
  },

  bridgeInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.bridgeInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/bridge`, {
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
          type: actionDescriptors.bridgeInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item has been bridged', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.bridgeInventoryFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.bridgeInventoryFailed,
          error: 'Error while bridging Item',
        });
        actions.setMessage(dispatch, 'Error while bridging Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.bridgeInventoryFailed,
          error: 'Unauthorized while bridging Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.bridgeInventoryFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.bridgeInventoryFailed,
        error: 'Error while bridging Item',
      });
      actions.setMessage(dispatch, 'Error while bridging Item');
    }
  },

  transferInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferInventory });

    try {
      const response = await fetch(`${apiUrl}/inventory/transfer`, {
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
        dispatch({ type: actionDescriptors.transferInventorySuccessful });
        actions.setMessage(dispatch, 'Item has been transferred', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.transferInventoryFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.transferInventoryFailed,
          error: 'Error while transferring Item',
        });
        actions.setMessage(dispatch, 'Error while transferring Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.transferInventoryFailed,
          error: 'Unauthorized while transferring Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.transferInventoryFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.transferInventoryFailed,
        error: 'Error while transferring Item',
      });
      actions.setMessage(dispatch, 'Error while transferring Item');
    }
  },

  // ---------------------------------------------------STAKING START-----------------------------------------------------------------
  stakeInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.stakeInventory });

    try {
      const response = await fetch(`${apiUrl}/reserve/stake`, {
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
          type: actionDescriptors.stakeInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item has been Staked Successfully', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.stakeInventoryFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.stakeInventoryFailed,
          error: 'Error while Staking Item',
        });
        actions.setMessage(dispatch, 'Error while Staking Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.stakeInventoryFailed,
          error: 'Unauthorized while Staking Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.stakeInventoryFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.stakeInventoryFailed,
        error: 'Error while Staking Item',
      });
      actions.setMessage(dispatch, 'Error while Staking Item');
    }
  },

  UnstakeInventory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.unstakeInventory });

    try {
      const response = await fetch(`${apiUrl}/reserve/unstake`, {
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
          type: actionDescriptors.unstakeInventorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item has been Unstaked', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.unstakeInventoryFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.unstakeInventoryFailed,
          error: 'Error while Unstaking Item',
        });
        actions.setMessage(dispatch, 'Error while Unstaking Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.unstakeInventoryFailed,
          error: 'Unauthorized while Unstaking Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.unstakeInventoryFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.unstakeInventoryFailed,
        error: 'Error while Unstaking Item',
      });
      actions.setMessage(dispatch, 'Error while Unstaking Item');
    }
  },

  getReserve: async (dispatch, address) => {
    dispatch({ type: actionDescriptors.getReserve });

    try {
      const response = await fetch(`${apiUrl}/reserve/${address}`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.getReserveSuccessful,
          payload: body.data,
        });
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.getReserveFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.getReserveFailed,
          error: 'Error while fetching the reserve',
        });
        actions.setMessage(dispatch, 'Errorwhile fetching the reserve');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getReserveFailed,
          error: 'Unauthorized while fetching the reserve',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.getReserveFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.getReserveFailed,
        error: 'Error while fetching the reserve',
      });
      actions.setMessage(dispatch, 'Error while fetching the reserve');
    }
  },

  getAllReserve: async (dispatch) => {
    dispatch({ type: actionDescriptors.getAllReserve });

    try {
      const response = await fetch(`${apiUrl}/reserve`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.getAllReserveSuccessful,
          payload: body.data,
        });
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.getAllReserveFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.getAllReserveFailed,
          error: 'Error while fetching the reserves',
        });
        actions.setMessage(dispatch, 'Errorwhile fetching the reserves');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getAllReserveFailed,
          error: 'Unauthorized while fetching the reserves',
        });
      }

      dispatch({
        type: actionDescriptors.getAllReserveFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.getAllReserveFailed,
        error: 'Error while fetching the reserve Address',
      });
      actions.setMessage(dispatch, 'Error while fetching the reserve Address');
    }
  },

  getEscrowForAsset: async (dispatch, assetRootAddress) => {
    dispatch({ type: actionDescriptors.getEscrowForAsset });

    try {
      const response = await fetch(`${apiUrl}/escrow/${assetRootAddress}`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.getEscrowForAssetSuccessful,
          payload: body.data,
        });
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.getEscrowForAssetFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.getEscrowForAssetFailed,
          error: 'Error while fetching the escrow',
        });
        actions.setMessage(dispatch, 'Errorwhile fetching the escrow');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getEscrowForAssetFailed,
          error: 'Unauthorized while fetching the escrow',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.getEscrowForAssetFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.getEscrowForAssetFailed,
        error: 'Error while fetching the escrow Address',
      });
      actions.setMessage(dispatch, 'Error while fetching the escrow Address');
    }
  },

  getUserCataRewards: async (dispatch) => {
    dispatch({ type: actionDescriptors.getUserCataRewards });

    try {
      const response = await fetch(`${apiUrl}/escrow/reward`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.getUserCataRewardsSuccessful,
          payload: body.data,
        });
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.getUserCataRewardsFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.getUserCataRewardsFailed,
          error: 'Error while fetching the rewards',
        });
        actions.setMessage(dispatch, 'Errorwhile fetching the rewards');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getUserCataRewardsFailed,
          error: 'Unauthorized while fetching the rewards',
        });
      }

      dispatch({
        type: actionDescriptors.getUserCataRewardsFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.getUserCataRewardsFailed,
        error: 'Error while fetching the rewards',
      });
      actions.setMessage(dispatch, 'Error while fetching the rewards');
    }
  },

  getOracle: async (dispatch, address) => {
    dispatch({ type: actionDescriptors.getOracle });

    try {
      const response = await fetch(`${apiUrl}/reserve/oraclePrice/${address}`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.getOracleSuccessful,
          payload: body.data,
        });
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.getOracleFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.getOracleFailed,
          error: 'Error while fetching the Oracle',
        });
        actions.setMessage(dispatch, 'Error while fetching the Oracle');
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getOracleFailed,
          error: 'Unauthorized while fetching the Oracle',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.getOracleFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
    } catch (err) {
      dispatch({
        type: actionDescriptors.getOracleFailed,
        error: 'Error while fetching the Oracle',
      });
      actions.setMessage(dispatch, 'Error while fetching the Oracle');
    }
  },

  borrow: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.borrow });

    try {
      const response = await fetch(`${apiUrl}/reserve/borrow`, {
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
        dispatch({ type: actionDescriptors.borrowSuccessful });
        actions.setMessage(dispatch, 'USDST successfully borrowed', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.borrowFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.borrowFailed,
          error: 'Error while borrowing USDST',
        });
        actions.setMessage(dispatch, 'Error while borrowing USDST');
        return false;
      }

      dispatch({
        type: actionDescriptors.borrowFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.borrowFailed,
        error: 'Error while borrowing USDST',
      });
      actions.setMessage(dispatch, 'Error while borrowing USDST');
    }
  },

  repay: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.repay });

    try {
      const response = await fetch(`${apiUrl}/reserve/repay`, {
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
        dispatch({ type: actionDescriptors.repaySuccessful });
        actions.setMessage(dispatch, 'USDST successfully repaid', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.repayFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.repayFailed,
          error: 'Error while repaying USDST',
        });
        actions.setMessage(dispatch, 'Error while repaying USDST');
        return false;
      }

      dispatch({
        type: actionDescriptors.repayFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.repayFailed,
        error: 'Error while repaying USDST',
      });
      actions.setMessage(dispatch, 'Error while repaying USDST');
    }
  },

  // ----------------------------------------------------------------STAKING END----------------------------------------------------------
  fetchItemTransfers: async (
    dispatch,
    limit,
    offset,
    ownerCommonName,
    order,
    date,
    search
  ) => {
    dispatch({ type: actionDescriptors.fetchItemTransfers });

    try {
      let range;
      let searchQuery;
      const end = date + 86400;
      if (date) {
        range = `&range[]=transferDate,${date},${end}`;
      }
      if (search) {
        const searchValue = isNaN(search) ? search : parseInt(search);
        if (!isNaN(searchValue)) {
          searchQuery = search ? `&transferNumber=${searchValue}` : '';
        } else {
          searchQuery = search
            ? `&queryValue=${searchValue}&queryFields=assetName`
            : '';
        }
      }
      let url = `${apiUrl}/inventory/transfers/items?limit=${limit}&order=transferDate.${order}&offset=${offset}&or=(oldOwnerCommonName.eq.${ownerCommonName},newOwnerCommonName.eq.${ownerCommonName})${
        search ? searchQuery : ''
      }${date ? range : ''}`;

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
          error: 'Unauthorized while fetching Item transfers',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchItemTransfersFailed,
        error: 'Error while fetching Item transfers',
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchItemTransfersFailed,
        error: 'Error while fetching Item transfers',
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
        error: 'Error while fetching Item',
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchInventoryDetailFailed,
        error: 'Error while fetching Item',
      });
    }
  },

  fetchInventoryOwnershipHistory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.fetchInventoryOwnershipHistory });

    try {
      const { originAddress, minItemNumber, maxItemNumber } = payload;
      const queryStr = `?originAddress=${originAddress}&minItemNumber=${minItemNumber}&maxItemNumber=${maxItemNumber}`;
      const response = await fetch(
        `${apiUrl}/inventory/ownership/history${queryStr}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

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
          error: 'Unauthorized while fetching ownership history',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchInventoryOwnershipHistoryFailed,
        error: 'Error while fetching ownership history',
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchInventoryOwnershipHistoryFailed,
        error: 'Error while fetching ownership history',
      });
      return false;
    }
  },

  uploadImage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.uploadImage });

    try {
      let response;
      try {
        response = await fetch(fileServerUrl, {
          method: HTTP_METHODS.POST,
          body: payload,
        });
      } catch (e) {
        console.log(JSON.stringify(e));
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
          error: 'Image upload failed',
        });
        actions.setMessage(dispatch, 'Error while uploading Image');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.uploadImageFailed,
          error: 'Unauthorized while trying to upload image',
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
        error: 'Image upload failed',
      });
      actions.setMessage(dispatch, 'Error while uploading Image');
    }
  },

  createItem: async (dispatch, payload, category) => {
    dispatch({ type: actionDescriptors.createItem });

    try {
      const response = await fetch(`${apiUrl}/${category}`, {
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
          type: actionDescriptors.createItemSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item created successfully', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.createItemFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.createItemFailed,
          error: 'Error while creating Item',
        });
        actions.setMessage(dispatch, 'Error while creating Item');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createItemFailed,
          error: 'Unauthorized while trying to create Item',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.createItemFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createItemFailed,
        error: 'Error while creating Item',
      });
      actions.setMessage(dispatch, 'Error while creating Item');
    }
  },

  fetchPriceHistory: async (
    dispatch,
    assetAddress,
    limit,
    offset,
    timeFilter
  ) => {
    dispatch({ type: actionDescriptors.fetchPriceHistory });
    try {
      const query = assetAddress
        ? `&assetToBeSold=${encodeURIComponent(assetAddress)}`
        : ``;
      let response = await fetch(
        `${apiUrl}/inventory/price/history?${query}&offset=${offset}&limit=${limit}&timeFilter=${timeFilter}`,
        {
          method: HTTP_METHODS.GET,
          credentials: 'same-origin',
        }
      );
      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchPriceHistoryFailed,
          payload: 'Error while fetching price history',
        });
        window.location.href = body.error.loginUrl;
      }
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchPriceHistorySuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({
        type: actionDescriptors.fetchPriceHistoryFailed,
        payload: 'Error while fetching price history',
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchPriceHistoryFailed,
        payload: 'Error while fetching price history',
      });
    }
  },
};

export { actionDescriptors, actions };
