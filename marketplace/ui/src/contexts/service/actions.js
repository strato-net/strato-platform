import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createService: "create_service",
  createServiceSuccessful: "create_service_successful",
  createServiceFailed: "create_service_failed",
  fetchService: "fetch_services",
  fetchServiceSuccessful: "fetch_service_successful",
  fetchServiceFailed: "fetch_service_failed",
  fetchServiceDetails: "fetch_service_details",
  fetchServiceDetailsSuccessful: "fetch_service_details_successful",
  fetchServiceDetailsFailed: "fetch_service_details_failed",
  transferServiceOwnership: "transfer_service_ownership",
  transferServiceOwnershipSuccessful: "transfer_service_ownership_successful",
  transferServiceOwnershipFailed: "transfer_service_ownership_failed",
  updateService: "update_service",
  updateServiceSuccessful: "update_service_successful",
  updateServiceFailed: "update_service_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchServiceAudit: "fetch_service_audit",
  fetchServiceAuditSuccessful: "fetch_service_audit_successful",
  fetchServiceAuditFailed: "fetch_service_audit_failed",
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

  createService: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createService });

    try {
      const response = await fetch(`${apiUrl}/service`, {
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
          type: actionDescriptors.createServiceSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Service created successfully", true)
        return true;
      }

      dispatch({ type: actionDescriptors.createServiceFailed, error: 'Error while creating Service' });
      actions.setMessage(dispatch, "Error while creating Service")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createServiceFailed, error: "Error while creating Service" });
      actions.setMessage(dispatch, "Error while creating Service")
    }
  },

  fetchServiceDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchServiceDetails });

    try {
      const response = await fetch(`${apiUrl}/service/${id}/${chainId}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchServiceDetailsSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchServiceDetailsFailed, error: 'Error while fetching Service' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchServiceDetailsFailed, error: "Error while fetching Service" });
    }
  },

  fetchService: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue
      ? `&name=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchService });

    try {
      const response = await fetch(`${apiUrl}/service?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchServiceSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchServiceFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchServiceFailed, error: undefined });
    }
  },
  transferServiceOwnership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferServiceOwnership });

    try {
      const response = await fetch(`${apiUrl}/service/transferOwnership`, {
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
          type: actionDescriptors.transferServiceOwnershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Service has been transferred", true);
        return true;
      }

      dispatch({ type: actionDescriptors.transferServiceOwnershipFailed, error: 'Error while transfer ownership Service' });
      actions.setMessage(dispatch, "Error while transfer ownership Service")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.transferServiceOwnershipFailed, error: "Error while transfer ownership Service" });
      actions.setMessage(dispatch, "Error while transfer ownership Service")
    }
  },
  updateService: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateService });

    try {
      const response = await fetch(`${apiUrl}/service/update`, {
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
          type: actionDescriptors.updateServiceSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Service has been updated", true);
        return true;
      }

      dispatch({ type: actionDescriptors.updateServiceFailed, error: 'Error while updating Service' });
      actions.setMessage(dispatch, "Error while updating Service")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateServiceFailed, error: "Error while updating Service" });
      actions.setMessage(dispatch, "Error while updating Service")
    }
  },
  fetchServiceAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchServiceDetails });

    try {
      const response = await fetch(`${apiUrl}/service/${address}/${chainId}/audit`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchServiceAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchServiceAuditFailed, error: 'Error while fetching audit' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchServiceAuditFailed, error: "Error while fetching audit" });
    }
  },
  importAssets: async (dispatch, assets) => {
    dispatch({ type: actionDescriptors.importAssetRequest });
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      try {
        const response = await fetch(`${apiUrl}/service`, {
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
