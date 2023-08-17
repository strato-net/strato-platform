import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createMembershipService: "create_membershipService",
  createMembershipServiceSuccessful: "create_membershipService_successful",
  createMembershipServiceFailed: "create_membershipService_failed",
  fetchMembershipService: "fetch_membershipServices",
  fetchMembershipServiceSuccessful: "fetch_membershipService_successful",
  fetchMembershipServiceFailed: "fetch_membershipService_failed",
  fetchMembershipServiceDetails: "fetch_membershipService_details",
  fetchMembershipServiceDetailsSuccessful: "fetch_membershipService_details_successful",
  fetchMembershipServiceDetailsFailed: "fetch_membershipService_details_failed",
  transferMembershipServiceOwnership: "transfer_membershipService_ownership",
  transferMembershipServiceOwnershipSuccessful: "transfer_membershipService_ownership_successful",
  transferMembershipServiceOwnershipFailed: "transfer_membershipService_ownership_failed",
  updateMembershipService: "update_membershipService",
  updateMembershipServiceSuccessful: "update_membershipService_successful",
  updateMembershipServiceFailed: "update_membershipService_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchMembershipServiceAudit: "fetch_membershipService_audit",
  fetchMembershipServiceAuditSuccessful: "fetch_membershipService_audit_successful",
  fetchMembershipServiceAuditFailed: "fetch_membershipService_audit_failed",
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

  createMembershipService: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createMembershipService });

    try {
      const response = await fetch(`${apiUrl}/membershipService`, {
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
          type: actionDescriptors.createMembershipServiceSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "MembershipService created successfully", true)
        return true;
      }

      dispatch({ type: actionDescriptors.createMembershipServiceFailed, error: 'Error while creating MembershipService' });
      actions.setMessage(dispatch, "Error while creating MembershipService")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createMembershipServiceFailed, error: "Error while creating MembershipService" });
      actions.setMessage(dispatch, "Error while creating MembershipService")
    }
  },

  fetchMembershipServiceDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchMembershipServiceDetails });

    try {
      const response = await fetch(`${apiUrl}/membershipService/${id}/${chainId}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMembershipServiceDetailsSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchMembershipServiceDetailsFailed, error: 'Error while fetching MembershipService' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchMembershipServiceDetailsFailed, error: "Error while fetching MembershipService" });
    }
  },

  fetchMembershipService: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue
      ? `&membershipId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchMembershipService });

    try {
      const response = await fetch(`${apiUrl}/membershipService?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMembershipServiceSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchMembershipServiceFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchMembershipServiceFailed, error: undefined });
    }
  },
  transferMembershipServiceOwnership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferMembershipServiceOwnership });

    try {
      const response = await fetch(`${apiUrl}/membershipService/transferOwnership`, {
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
          type: actionDescriptors.transferMembershipServiceOwnershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "MembershipService has been transferred", true);
        return true;
      }

      dispatch({ type: actionDescriptors.transferMembershipServiceOwnershipFailed, error: 'Error while transfer ownership MembershipService' });
      actions.setMessage(dispatch, "Error while transfer ownership MembershipService")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.transferMembershipServiceOwnershipFailed, error: "Error while transfer ownership MembershipService" });
      actions.setMessage(dispatch, "Error while transfer ownership MembershipService")
    }
  },
  updateMembershipService: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateMembershipService });

    try {
      const response = await fetch(`${apiUrl}/membershipService/update`, {
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
          type: actionDescriptors.updateMembershipServiceSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "MembershipService has been updated", true);
        return true;
      }

      dispatch({ type: actionDescriptors.updateMembershipServiceFailed, error: 'Error while updating MembershipService' });
      actions.setMessage(dispatch, "Error while updating MembershipService")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateMembershipServiceFailed, error: "Error while updating MembershipService" });
      actions.setMessage(dispatch, "Error while updating MembershipService")
    }
  },
  fetchMembershipServiceAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchMembershipServiceDetails });

    try {
      const response = await fetch(`${apiUrl}/membershipService/${address}/${chainId}/audit`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMembershipServiceAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchMembershipServiceAuditFailed, error: 'Error while fetching audit' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchMembershipServiceAuditFailed, error: "Error while fetching audit" });
    }
  },
  importAssets: async (dispatch, assets) => {
    dispatch({ type: actionDescriptors.importAssetRequest });
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      try {
        const response = await fetch(`${apiUrl}/membershipService`, {
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
