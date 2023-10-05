import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createMembership: "create_membership",
  createMembershipSuccessful: "create_membership_successful",
  createMembershipFailed: "create_membership_failed",
  fetchMembership: "fetch_memberships",
  fetchMembershipSuccessful: "fetch_membership_successful",
  fetchMembershipFailed: "fetch_membership_failed",
  fetchMembershipDetails: "fetch_membership_details",
  fetchMembershipDetailsSuccessful: "fetch_membership_details_successful",
  fetchMembershipDetailsFailed: "fetch_membership_details_failed",
  transferMembershipOwnership: "transfer_membership_ownership",
  transferMembershipOwnershipSuccessful: "transfer_membership_ownership_successful",
  transferMembershipOwnershipFailed: "transfer_membership_ownership_failed",
  updateMembership: "update_membership",
  updateMembershipSuccessful: "update_membership_successful",
  updateMembershipFailed: "update_membership_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchMembershipAudit: "fetch_membership_audit",
  fetchMembershipAuditSuccessful: "fetch_membership_audit_successful",
  fetchMembershipAuditFailed: "fetch_membership_audit_failed",
  importAssetRequest: "import_asset_request",
  importAssetSuccess: "import_asset_success",
  importAssetFailure: "import_asset_failure",
  updateAssetImportCount: "update_asset_import_count",
  updateAssetUploadError: "update_asset_upload_error",
  openImportCSVModal: "open_import_csv_modal",
  closeImportCSVModal: "close_import_csv_modal",
  fetchMembershipFromDetails: "fetch_membership_of_inventory",
  fetchMembershipFromDetailsSuccessful: "fetch_membership_of_inventory_successful",
  fetchMembershipFromDetailsFailed: "fetch_membership_of_inventory_failed",
  onboardSellerToStripe: "onboard_seller_to_stripe",
  onboardSellerToStripeSuccessful: "onboard_seller_to_stripe_successful",
  onboardSellerToStripeFailed: "onboard_seller_to_stripe_failed",
  sellerStripeStatus: "seller_stripe_status",
  sellerStripeStatusSuccessful: "seller_stripe_status_successful",
  sellerStripeStatusFailed: "seller_stripe_status_failed",
  fetchPurchasedMemberships: "fetch_purchased_memberships",
  fetchPurchasedMembershipsSuccessful: "fetch_purchased_memberships_successful",
  fetchPurchasedMembershipsFailed: "fetch_purchased_memberships_failed",
  fetchIssuedMemberships: "fetch_issued_memberships",
  fetchIssuedMembershipsSuccessful: "fetch_issued_memberships_successful",
  fetchIssuedMembershipsFailed: "fetch_issued_memberships_failed",
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

  createMembership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createMembership });

    try {
      const response = await fetch(`${apiUrl}/membership`, {
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
          type: actionDescriptors.createMembershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Membership created successfully", true)
        console.log("Membership created successfully ======= body", body)
        return body.data
      }

      dispatch({ type: actionDescriptors.createMembershipFailed, error: 'Error while creating Membership' });
      actions.setMessage(dispatch, "Error while creating Membership")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createMembershipFailed, error: "Error while creating Membership" });
      actions.setMessage(dispatch, "Error while creating Membership")
    }
  },

  fetchMembershipDetails: async (dispatch, id) => {
    dispatch({ type: actionDescriptors.fetchMembershipDetails });

    try {
      const response = await fetch(`${apiUrl}/membership/${id}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMembershipDetailsSuccessful,
          payload: body.data,
        });

        return body.data;
      }

      dispatch({ type: actionDescriptors.fetchMembershipDetailsFailed, error: 'Error while fetching Membership' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchMembershipDetailsFailed, error: "Error while fetching Membership" });
    }
  },

  fetchMembership: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue
      ? `&productId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchMembership });

    try {
      const response = await fetch(`${apiUrl}/membership?${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMembershipSuccessful,
          payload: body.data,
        });

        return;
      }
      dispatch({ type: actionDescriptors.fetchMembershipFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchMembershipFailed, error: undefined });
    }
  },
  transferMembershipOwnership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferMembershipOwnership });

    try {
      const response = await fetch(`${apiUrl}/membership/transferOwnership`, {
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
          type: actionDescriptors.transferMembershipOwnershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Membership has been transferred", true);
        return true;
      }

      dispatch({ type: actionDescriptors.transferMembershipOwnershipFailed, error: 'Error while transfer ownership Membership' });
      actions.setMessage(dispatch, "Error while transfer ownership Membership")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.transferMembershipOwnershipFailed, error: "Error while transfer ownership Membership" });
      actions.setMessage(dispatch, "Error while transfer ownership Membership")
    }
  },
  updateMembership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateMembership });

    try {
      const response = await fetch(`${apiUrl}/membership/update`, {
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
          type: actionDescriptors.updateMembershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Membership has been updated", true);
        return true;
      }

      dispatch({ type: actionDescriptors.updateMembershipFailed, error: 'Error while updating Membership' });
      actions.setMessage(dispatch, "Error while updating Membership")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateMembershipFailed, error: "Error while updating Membership" });
      actions.setMessage(dispatch, "Error while updating Membership")
    }
  },
  fetchMembershipAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchMembershipDetails });

    try {
      const response = await fetch(`${apiUrl}/membership/${address}/${chainId}/audit`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMembershipAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchMembershipAuditFailed, error: 'Error while fetching audit' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchMembershipAuditFailed, error: "Error while fetching audit" });
    }
  },
  importAssets: async (dispatch, assets) => {
    dispatch({ type: actionDescriptors.importAssetRequest });
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      try {
        const response = await fetch(`${apiUrl}/membership`, {
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

  fetchMembershipFromDetails: async (dispatch, limit, offset, queryValue, membershipId) => {
    const query = queryValue
      ? `&serviceTypeId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchMembershipFromDetails });

    try {
      //would use membershipId here and use getAll
      const response = await fetch(`${apiUrl}/membership/${membershipId}?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();
      console.log("fetchMembershipFromDetails response: ", body.data)
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMembershipFromDetailsSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchMembershipFromDetailsFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchMembershipFromDetailsFailed, error: undefined });
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

  fetchPurchasedMemberships: async (dispatch) => {
    // const query = queryValue
    //   ? `&serviceTypeId=${queryValue}`
    //   : "";

    dispatch({ type: actionDescriptors.fetchPurchasedMemberships });

    try {
      const response = await fetch(`${apiUrl}/membership/purchased`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchPurchasedMembershipsSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchPurchasedMembershipsFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchPurchasedMembershipsFailed, error: undefined });
    }
  },

  fetchIssuedMemberships: async (dispatch) => {
    // const query = queryValue
    //   ? `&serviceTypeId=${queryValue}`
    //   : "";

    dispatch({ type: actionDescriptors.fetchIssuedMemberships });

    try {
      const response = await fetch(`${apiUrl}/membership/issued`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchIssuedMembershipsSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchIssuedMembershipsFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchIssuedMembershipsFailed, error: undefined });
    }
  },
};

export { actionDescriptors, actions };
