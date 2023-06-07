import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createOrderLineItem: "create_orderLineItem",
  createOrderLineItemSuccessful: "create_orderLineItem_successful",
  createOrderLineItemFailed: "create_orderLineItem_failed",
  fetchOrderLineItem: "fetch_orderLineItems",
  fetchOrderLineItemSuccessful: "fetch_orderLineItem_successful",
  fetchOrderLineItemFailed: "fetch_orderLineItem_failed",
  fetchOrderLineItemDetails: "fetch_orderLineItem_details",
  fetchOrderLineItemDetailsSuccessful: "fetch_orderLineItem_details_successful",
  fetchOrderLineItemDetailsFailed: "fetch_orderLineItem_details_failed",
  transferOrderLineItemOwnership: "transfer_orderLineItem_ownership",
  transferOrderLineItemOwnershipSuccessful: "transfer_orderLineItem_ownership_successful",
  transferOrderLineItemOwnershipFailed: "transfer_orderLineItem_ownership_failed",
  updateOrderLineItem: "update_orderLineItem",
  updateOrderLineItemSuccessful: "update_orderLineItem_successful",
  updateOrderLineItemFailed: "update_orderLineItem_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchOrderLineItemAudit: "fetch_orderLineItem_audit",
  fetchOrderLineItemAuditSuccessful: "fetch_orderLineItem_audit_successful",
  fetchOrderLineItemAuditFailed: "fetch_orderLineItem_audit_failed",
  importAssetRequest: "import_asset_request",
  importAssetSuccess: "import_asset_success",
  importAssetFailure: "import_asset_failure",
  updateAssetImportCount: "update_asset_import_count",
  updateAssetUploadError: "update_asset_upload_error",
  openImportCSVModal: "open_import_csv_modal",
  closeImportCSVModal: "close_import_csv_modal"
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

  createOrderLineItem: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createOrderLineItem });

    try {
      const response = await fetch(`${apiUrl}/orderLineItem`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createOrderLineItemSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "OrderLineItem created successfully", true)
        return true;
      }

      dispatch({ type: actionDescriptors.createOrderLineItemFailed, error: 'Error while creating OrderLineItem' });
      actions.setMessage(dispatch, "Error while creating OrderLineItem")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createOrderLineItemFailed, error: "Error while creating OrderLineItem" });
      actions.setMessage(dispatch, "Error while creating OrderLineItem")
    }
  },

  fetchOrderLineItemDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchOrderLineItemDetails });

    try {
      const response = await fetch(`${apiUrl}/orderLineItem/${id}/${chainId}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchOrderLineItemDetailsSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchOrderLineItemDetailsFailed, error: 'Error while fetching OrderLineItem' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchOrderLineItemDetailsFailed, error: "Error while fetching OrderLineItem" });
    }
  },

  fetchOrderLineItem: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue
      ? `&orderId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchOrderLineItem });

    try {
      const response = await fetch(`${apiUrl}/orderLineItem?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchOrderLineItemSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchOrderLineItemFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchOrderLineItemFailed, error: undefined });
    }
  },
  transferOrderLineItemOwnership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferOrderLineItemOwnership });

    try {
      const response = await fetch(`${apiUrl}/orderLineItem/transferOwnership`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.transferOrderLineItemOwnershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been transferred", true);
        return true;
      }

      dispatch({ type: actionDescriptors.transferOrderLineItemOwnershipFailed, error: 'Error while transfer ownership OrderLineItem' });
      actions.setMessage(dispatch, "Error while transfer ownership OrderLineItem")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.transferOrderLineItemOwnershipFailed, error: "Error while transfer ownership OrderLineItem" });
      actions.setMessage(dispatch, "Error while transfer ownership OrderLineItem")
    }
  },
  updateOrderLineItem: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateOrderLineItem });

    try {
      const response = await fetch(`${apiUrl}/orderLineItem/update`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateOrderLineItemSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been updated", true);
        return true;
      }

      dispatch({ type: actionDescriptors.updateOrderLineItemFailed, error: 'Error while updating OrderLineItem' });
      actions.setMessage(dispatch, "Error while updating OrderLineItem")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateOrderLineItemFailed, error: "Error while updating OrderLineItem" });
      actions.setMessage(dispatch, "Error while updating OrderLineItem")
    }
  },
  fetchOrderLineItemAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchOrderLineItemDetails });

    try {
      const response = await fetch(`${apiUrl}/orderLineItem/${address}/${chainId}/audit`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchOrderLineItemAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchOrderLineItemAuditFailed, error: 'Error while fetching audit' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchOrderLineItemAuditFailed, error: "Error while fetching audit" });
    }
  },
  importAssets: async (dispatch, assets) => {
    dispatch({ type: actionDescriptors.importAssetRequest });
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      try {
        const response = await fetch(`${apiUrl}/orderLineItem`, {
          method: HTTP_METHODS.POST,
          credentials: "same-origin",
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(assets[i])
        });

        if (response.status === RestStatus.OK) {
          dispatch({
            type: actionDescriptors.updateAssetImportCount,
            count: i+1,
          });
        } else {
          errors.push({ status: response.error.status, error: response.error.data.method, id: i })
        }        
      } catch (err) {
        //  nothing
      }
    }

    dispatch({ type: actionDescriptors.importAssetSuccess });
    dispatch({ type: actionDescriptors.updateAssetUploadError, errors });
    actions.setMessage(dispatch, `Imported ${assets.length} records`, true)
  },
};

export { actionDescriptors, actions };
