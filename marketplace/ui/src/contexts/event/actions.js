import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createEvent: "create_event",
  createEventSuccessful: "create_event_successful",
  createEventFailed: "create_event_failed",
  fetchCertifyEvent: "fetch_certify_event",
  fetchCertifyEventSuccessful: "fetch_certify_event_successful",
  fetchCertifyEventFailed: "fetch_certify_event_failed",
  fetchEvent: "fetch_events",
  fetchEventSuccessful: "fetch_event_successful",
  fetchEventFailed: "fetch_event_failed",
  fetchEventOfInventory: "fetch_event_of_inventory",
  fetchEventOfInventorySuccessful: "fetch_event_of_inventory_successful",
  fetchEventOfInventoryFailed: "fetch_event_of_inventory_failed",
  fetchEventOfItem: "fetch_event_of_item",
  fetchEventOfItemSuccessful: "fetch_event_of_item_successful",
  fetchEventOfItemFailed: "fetch_event_of_item_failed",
  fetchEventDetails: "fetch_event_details",
  fetchEventDetailsSuccessful: "fetch_event_details_successful",
  fetchEventDetailsFailed: "fetch_event_details_failed",
  transferEventOwnership: "transfer_event_ownership",
  transferEventOwnershipSuccessful: "transfer_event_ownership_successful",
  transferEventOwnershipFailed: "transfer_event_ownership_failed",
  updateEvent: "update_event",
  updateEventSuccessful: "update_event_successful",
  updateEventFailed: "update_event_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchEventAudit: "fetch_event_audit",
  fetchEventAuditSuccessful: "fetch_event_audit_successful",
  fetchEventAuditFailed: "fetch_event_audit_failed",
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

  createEvent: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createEvent });

    try {
      const response = await fetch(`${apiUrl}/event`, {
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
          type: actionDescriptors.createEventSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Event created successfully", true)
        return true;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.createEventFailed, error: "Error while creating Event" });
        actions.setMessage(dispatch, "Error while creating Event")
        return false;
      }

      dispatch({ type: actionDescriptors.createEventFailed, error: body.error });
      actions.setMessage(dispatch, body.error)
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createEventFailed,  error: "Error while creating Event" });
      actions.setMessage(dispatch,  "Error while creating Event")
    }
  },

  fetchEventDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchEventDetails });

    try {
      const response = await fetch(`${apiUrl}/event/${id}/${chainId}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchEventDetailsSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchEventDetailsFailed, error: 'Error while fetching Event' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchEventDetailsFailed, error: "Error while fetching Event" });
    }
  },

  fetchEvent: async (dispatch, limit, offset, queryValue,organization) => {
    const query = queryValue
      ? `&eventTypeId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchEvent });

    try {
      const response = await fetch(organization!=null?`${apiUrl}/event?limit=${limit}&offset=${offset}${query}&ownerOrganization=${organization}` :`${apiUrl}/event?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchEventSuccessful,
          payload: body.data,
        });
        return;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.fetchEventFailed, error: "Error while fetching Event" });
      }

      dispatch({ type: actionDescriptors.fetchEventFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchEventFailed, error: "Error while fetching Event"  });
    }
  },

  fetchCertifyEvent: async (dispatch) => {

    dispatch({ type: actionDescriptors.fetchCertifyEvent });

    try {
      const response = await fetch(`${apiUrl}/event?filterByCertifier=true`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchCertifyEventSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ 
          type: actionDescriptors.fetchCertifyEventFailed, 
          error: "Error while fetching certify events" 
        });
        actions.setMessage(dispatch, "Error while fetching certify events" )
      }
      dispatch({ 
        type: actionDescriptors.fetchCertifyEventFailed, 
        error: body.error 
      });
      actions.setMessage(dispatch, body.error.message)
    } catch (err) {
      dispatch({ 
        type: actionDescriptors.fetchCertifyEventFailed, 
        error: "Error while fetching certify events" 
      });
      actions.setMessage(dispatch, "Error while fetching certify events" )
    }
  },

  fetchEventOfInventory: async (dispatch, limit, offset, queryValue,inventoryId) => {
    const query = queryValue
      ? `&eventTypeId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchEventOfInventory });

    try {
      const response = await fetch(`${apiUrl}/event/${inventoryId}?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchEventOfInventorySuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchEventOfInventoryFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchEventOfInventoryFailed, error: undefined });
    }
  },

  fetchEventOfItem: async (dispatch, limit, offset, queryValue,itemId) => {
    const query = queryValue
      ? `&eventTypeId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchEventOfItem });

    try {
      const response = await fetch(`${apiUrl}/event?itemAddress=${itemId}&limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchEventOfItemSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchEventOfItemFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchEventOfItemFailed, error: undefined });
    }
  },

  transferEventOwnership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferEventOwnership });

    try {
      const response = await fetch(`${apiUrl}/event/transferOwnership`, {
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
          type: actionDescriptors.transferEventOwnershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been transferred", true);
        return true;
      }

      dispatch({ type: actionDescriptors.transferEventOwnershipFailed, error: 'Error while transfer ownership Event' });
      actions.setMessage(dispatch, "Error while transfer ownership Event")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.transferEventOwnershipFailed, error: "Error while transfer ownership Event" });
      actions.setMessage(dispatch, "Error while transfer ownership Event")
    }
  },
  updateEvent: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateEvent });

    try {
      const response = await fetch(`${apiUrl}/event/update`, {
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
          type: actionDescriptors.updateEventSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Certifier comment has been updated", true);
        return true;
      }else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.updateEventFailed, error: 'Error while updating certifier comment' });
        return false;
      }

      dispatch({ type: actionDescriptors.updateEventFailed, error: body.error });
      actions.setMessage(dispatch, body.error)
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateEventFailed, error: "Error while updating certifier comment" });
      actions.setMessage(dispatch, "Error while updating certifier comment")
    }
  },
  fetchEventAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchEventDetails });

    try {
      const response = await fetch(`${apiUrl}/event/${address}/${chainId}/audit`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchEventAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchEventAuditFailed, error: 'Error while fetching audit' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchEventAuditFailed, error: "Error while fetching audit" });
    }
  },
  importAssets: async (dispatch, assets) => {
    dispatch({ type: actionDescriptors.importAssetRequest });
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      try {
        const response = await fetch(`${apiUrl}/event`, {
          method: HTTP_METHODS.POST,
          credentials: "same-origin",
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(assets[i])
        });

        const body = await response.json();

        if (response.status === RestStatus.OK) {
          dispatch({
            type: actionDescriptors.updateAssetImportCount,
            count: i + 1,
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
