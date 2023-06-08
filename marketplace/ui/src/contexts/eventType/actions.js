import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createEventType: "create_eventType",
  createEventTypeSuccessful: "create_eventType_successful",
  createEventTypeFailed: "create_eventType_failed",
  fetchEventType: "fetch_eventTypes",
  fetchEventTypeSuccessful: "fetch_eventType_successful",
  fetchEventTypeFailed: "fetch_eventType_failed",
  fetchEventTypeDetails: "fetch_eventType_details",
  fetchEventTypeDetailsSuccessful: "fetch_eventType_details_successful",
  fetchEventTypeDetailsFailed: "fetch_eventType_details_failed",
  transferEventTypeOwnership: "transfer_eventType_ownership",
  transferEventTypeOwnershipSuccessful: "transfer_eventType_ownership_successful",
  transferEventTypeOwnershipFailed: "transfer_eventType_ownership_failed",
  updateEventType: "update_eventType",
  updateEventTypeSuccessful: "update_eventType_successful",
  updateEventTypeFailed: "update_eventType_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchEventTypeAudit: "fetch_eventType_audit",
  fetchEventTypeAuditSuccessful: "fetch_eventType_audit_successful",
  fetchEventTypeAuditFailed: "fetch_eventType_audit_failed",
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

  createEventType: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createEventType });

    try {
      const response = await fetch(`${apiUrl}/eventType`, {
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
          type: actionDescriptors.createEventTypeSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "EventType created successfully", true)
        return true;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR){
        dispatch({ type: actionDescriptors.createEventTypeFailed, error: "Error while creating Event Type" });
        actions.setMessage(dispatch, "Error while creating Event Type")
        return false;
      }

      dispatch({ type: actionDescriptors.createEventTypeFailed, error: body.error });
      actions.setMessage(dispatch, body.error)
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createEventTypeFailed,  error: "Error while creating Event Type"  });
      actions.setMessage(dispatch, "Error while creating Event Type")
    }
  },

  fetchEventTypeDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchEventTypeDetails });

    try {
      const response = await fetch(`${apiUrl}/eventType/${id}/${chainId}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchEventTypeDetailsSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchEventTypeDetailsFailed, error: 'Error while fetching EventType' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchEventTypeDetailsFailed, error: "Error while fetching EventType" });
    }
  },

  fetchEventType: async (dispatch, limit, offset, queryValue) => {
      const query = queryValue
      ? `&queryValue=${queryValue}&queryFields=name`
      : "";
      
    dispatch({ type: actionDescriptors.fetchEventType });

    try {
      const response = await fetch(`${apiUrl}/eventType?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchEventTypeSuccessful,
          payload: body.data,
        });
        return;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.fetchEventTypeFailed, error: "Error while fetching Event Type" });
      }
      dispatch({ type: actionDescriptors.fetchEventTypeFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchEventTypeFailed, error: "Error while fetching Event Type" });
    }
  },
  transferEventTypeOwnership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferEventTypeOwnership });

    try {
      const response = await fetch(`${apiUrl}/eventType/transferOwnership`, {
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
          type: actionDescriptors.transferEventTypeOwnershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been transferred", true);
        return true;
      }

      dispatch({ type: actionDescriptors.transferEventTypeOwnershipFailed, error: 'Error while transfer ownership EventType' });
      actions.setMessage(dispatch, "Error while transfer ownership EventType")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.transferEventTypeOwnershipFailed, error: "Error while transfer ownership EventType" });
      actions.setMessage(dispatch, "Error while transfer ownership EventType")
    }
  },
  updateEventType: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateEventType });

    try {
      const response = await fetch(`${apiUrl}/eventType/update`, {
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
          type: actionDescriptors.updateEventTypeSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been updated", true);
        return true;
      }

      dispatch({ type: actionDescriptors.updateEventTypeFailed, error: 'Error while updating EventType' });
      actions.setMessage(dispatch, "Error while updating EventType")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateEventTypeFailed, error: "Error while updating EventType" });
      actions.setMessage(dispatch, "Error while updating EventType")
    }
  },
  fetchEventTypeAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchEventTypeDetails });

    try {
      const response = await fetch(`${apiUrl}/eventType/${address}/${chainId}/audit`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchEventTypeAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchEventTypeAuditFailed, error: 'Error while fetching audit' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchEventTypeAuditFailed, error: "Error while fetching audit" });
    }
  },
  importAssets: async (dispatch, assets) => {
    dispatch({ type: actionDescriptors.importAssetRequest });
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      try {
        const response = await fetch(`${apiUrl}/eventType`, {
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
