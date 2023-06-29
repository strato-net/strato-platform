import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createItem: "create_item",
  createItemSuccessful: "create_item_successful",
  createItemFailed: "create_item_failed",
  fetchItem: "fetch_items",
  fetchItemSuccessful: "fetch_item_successful",
  fetchItemFailed: "fetch_item_failed",
  fetchItemDetails: "fetch_item_details",
  fetchItemDetailsSuccessful: "fetch_item_details_successful",
  fetchItemDetailsFailed: "fetch_item_details_failed",
  transferItemOwnership: "transfer_item_ownership",
  transferItemOwnershipSuccessful: "transfer_item_ownership_successful",
  transferItemOwnershipFailed: "transfer_item_ownership_failed",
  updateItem: "update_item",
  updateItemSuccessful: "update_item_successful",
  updateItemFailed: "update_item_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchItemAudit: "fetch_item_audit",
  fetchItemAuditSuccessful: "fetch_item_audit_successful",
  fetchItemAuditFailed: "fetch_item_audit_failed",
  importAssetRequest: "import_asset_request",
  importAssetSuccess: "import_asset_success",
  importAssetFailure: "import_asset_failure",
  updateAssetImportCount: "update_asset_import_count",
  updateAssetUploadError: "update_asset_upload_error",
  openImportCSVModal: "open_import_csv_modal",
  closeImportCSVModal: "close_import_csv_modal",
  fetchSerialNumbers: "fetch_serial_numbers",
  fetchSerialNumbersSuccessful: "fetch_serial_numbers_success",
  fetchSerialNumbersFailed: "fetch_serial_numbers_failed",
  fetchItemOwnershipHistory: "fetch_item_ownership_history",
  fetchItemOwnershipHistorySuccessful: "fetch_item_ownership_history_successful",
  fetchItemOwnershipHistoryFailed: "fetch_item_ownership_history_failed",
  fetchItemRawMaterials: "fetch_item_raw_materials",
  fetchItemRawMaterialsSuccessful: "fetch_item_raw_materials_successful",
  fetchItemRawMaterialsFailed: "fetch_item_raw_materials_failed",
  setActualRawMaterials: "set_actual_raw_materials"
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  openImportCSVmodal: (dispatch) => {
    dispatch({ type: actionDescriptors.openImportCSVModal });
  },

  closeImportCSVmodal: (dispatch) => {
    dispatch({ type: actionDescriptors.closeImportCSVModal });
  },

  setActualRawMaterials: (dispatch, payload) => {
    dispatch({
      type: actionDescriptors.setActualRawMaterials,
      payload: payload,
   });  
  },

  createItem: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createItem });

    try {
      const response = await fetch(`${apiUrl}/item`, {
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
      }

      dispatch({
        type: actionDescriptors.createItemFailed,
        error: "Error while creating Item",
      });
      actions.setMessage(dispatch, "Error while creating Item");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createItemFailed,
        error: "Error while creating Item",
      });
      actions.setMessage(dispatch, "Error while creating Item");
    }
  },

  fetchItemDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchItemDetails });

    try {
      const response = await fetch(`${apiUrl}/item/${id}/${chainId}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchItemDetailsSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({
        type: actionDescriptors.fetchItemDetailsFailed,
        error: "Error while fetching Item",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchItemDetailsFailed,
        error: "Error while fetching Item",
      });
    }
  },

  fetchSerialNumbers: async (dispatch, id) => {
    dispatch({ type: actionDescriptors.fetchSerialNumbers });

    try {
      const response = await fetch(`${apiUrl}/item?inventoryId=${id}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSerialNumbersSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({
        type: actionDescriptors.fetchSerialNumbersFailed,
        error: "Error while fetching serial numbers",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchSerialNumbersFailed,
        error: "Error while fetching serial numbers",
      });
    }
  },

  fetchItemOwnershipHistory: async (dispatch, id) => {
    dispatch({ type: actionDescriptors.fetchItemOwnershipHistory });

    try {
      const response = await fetch(`${apiUrl}/item/ownership/${id}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchItemOwnershipHistorySuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({
        type: actionDescriptors.fetchItemOwnershipHistoryFailed,
        error: "Error while fetching ownership history",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchItemOwnershipHistoryFailed,
        error: "Error while fetching ownership history",
      });
      return false;
    }
  },

  fetchItemRawMaterials: async (dispatch, itemUniqueProductCode, itemSerialNumber) => {

    dispatch({ type: actionDescriptors.fetchItemRawMaterials });

    try {
      const response = await fetch(
        `${apiUrl}/item/rawmaterials?itemUniqueProductCode=${itemUniqueProductCode}&itemSerialNumber=${itemSerialNumber}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchItemRawMaterialsSuccessful,
          payload: body.data,
        });
        return;
      }else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ 
          type: actionDescriptors.fetchItemRawMaterialsFailed, 
          error: "Error while fetching item raw materials" 
        });
        return;
      }

      dispatch({ type: actionDescriptors.fetchItemRawMaterialsFailed, error: body.error });
    } catch (err) {
      dispatch({ 
        type: actionDescriptors.fetchItemRawMaterialsFailed, 
        error: "Error while fetching item raw materials" 
      });
    }
  },

  fetchItem: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue ? `&inventoryId=${queryValue}` : "";

    dispatch({ type: actionDescriptors.fetchItem });

    try {
      const response = await fetch(
        `${apiUrl}/item?limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchItemSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchItemFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchItemFailed, error: undefined });
    }
  },
  transferItemOwnership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferItemOwnership });

    try {
      const response = await fetch(`${apiUrl}/item/transferOwnership`, {
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
          type: actionDescriptors.transferItemOwnershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been transferred", true);
        return true;
      }

      dispatch({
        type: actionDescriptors.transferItemOwnershipFailed,
        error: "Error while transfer ownership Item",
      });
      actions.setMessage(dispatch, "Error while transfer ownership Item");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.transferItemOwnershipFailed,
        error: "Error while transfer ownership Item",
      });
      actions.setMessage(dispatch, "Error while transfer ownership Item");
    }
  },
  updateItem: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateItem });

    try {
      const response = await fetch(`${apiUrl}/item/update`, {
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
          type: actionDescriptors.updateItemSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been updated", true);
        return true;
      }

      dispatch({
        type: actionDescriptors.updateItemFailed,
        error: "Error while updating Item",
      });
      actions.setMessage(dispatch, "Error while updating Item");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateItemFailed,
        error: "Error while updating Item",
      });
      actions.setMessage(dispatch, "Error while updating Item");
    }
  },
  fetchItemAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchItemDetails });

    try {
      const response = await fetch(
        `${apiUrl}/item/${address}/${chainId}/audit`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchItemAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({
        type: actionDescriptors.fetchItemAuditFailed,
        error: "Error while fetching audit",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchItemAuditFailed,
        error: "Error while fetching audit",
      });
    }
  },
  importAssets: async (dispatch, assets) => {
    dispatch({ type: actionDescriptors.importAssetRequest });
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      try {
        const response = await fetch(`${apiUrl}/item`, {
          method: HTTP_METHODS.POST,
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(assets[i]),
        });

        if (response.status === RestStatus.OK) {
          dispatch({
            type: actionDescriptors.updateAssetImportCount,
            count: i + 1,
          });
        } else {
          errors.push({
            status: response.error.status,
            error: response.error.data.method,
            id: i,
          });
        }
      } catch (err) {
        //  nothing
      }
    }

    dispatch({ type: actionDescriptors.importAssetSuccess });
    dispatch({ type: actionDescriptors.updateAssetUploadError, errors });
    actions.setMessage(dispatch, `Imported ${assets.length} records`, true);
  },
};

export { actionDescriptors, actions };
