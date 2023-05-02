import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  resetMessage: "reset_message",
  setMessage: "set_message",
  requestUserMembership: 'request_user_membership',
  requestUserMembershipSuccessful: 'request_user_membership_successful',
  requestUserMembershipFailed: 'request_user_membership_failed',
  updateUserMembership: 'update_user_membership',
  updateUserMembershipSuccessful: 'update_user_membership_successful',
  updateUserMembershipFailed: 'update_user_membership_failed',
  addUserMembership: 'add_user_membership',
  addUserMembershipSuccessful: 'add_user_membership_successful',
  addUserMembershipFailed: 'add_user_membership_failed',
  fetchPendingRequestsList: "fetch_pending_requests_list",
  fetchPendingRequestsListSuccessful: "fetch_pending_requests_list_successful",
  fetchPendingRequestsListFailed: "fetch_pending_requests_list_failed",
  fetchRequestsList: "fetch_pending_requests_list",
  fetchRequestsListSuccessful: "fetch_pending_requests_list_successful",
  fetchRequestsListFailed: "fetch_pending_requests_list_failed",
  fetchApprovedUsersList: "fetch_approved_users_list",
  fetchApprovedUsersListSuccessful: "fetch_papproved_users_list_successful",
  fetchApprovedUsersListFailed: "fetch_approved_users_list_failed",
  approveRejectMembershipRequest: "approve_reject_membership_request",
  approveRejectMembershipRequestSuccessful: "approve_reject_membership_request_successful",
  approveRejectMembershipRequestFailed: "approve_reject_membership_request_failed",

};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  requestUserMembership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.requestUserMembership });
    try {
      const response = await fetch(`${apiUrl}/membership/requests`, {
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
          type: actionDescriptors.requestUserMembershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Requested User membership successfully", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.requestUserMembershipFailed,
          error: "Error while requesting user membership",
        });
        actions.setMessage(dispatch, "Error while requesting user membership");
        return false;
      }

      dispatch({
        type: actionDescriptors.requestUserMembershipFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.requestUserMembershipFailed,
        error: "Error while requesting user membership",
      });
      actions.setMessage(dispatch, "Error while requesting user membership");
    }
  },

  updateUserMembership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateUserMembership });

    try {
      const response = await fetch(`${apiUrl}/membership`, {
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
          type: actionDescriptors.updateUserMembershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "User membership has been updated", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateUserMembershipFailed,
          error: "Error while updating user membership",
        });
        actions.setMessage(dispatch, "Error while updating user membership");
        return false;
      }

      dispatch({
        type: actionDescriptors.updateUserMembershipFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateUserMembershipFailed,
        error: "Error while updating user membership",
      });
      actions.setMessage(dispatch, "Error while updating user membership");
    }
  },


  addUserMembership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.addUserMembership });
    try {
      const response = await fetch(`${apiUrl}/membership`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.CREATED) {
        dispatch({
          type: actionDescriptors.addUserMembershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "User membership added successfully", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.addUserMembershipFailed,
          error: "Error while adding user membership",
        });
        actions.setMessage(dispatch, "Error while adding user membership");
        return false;
      }

      dispatch({
        type: actionDescriptors.addUserMembershipFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.addUserMembershipFailed,
        error: "Error while adding user membership",
      });
      actions.setMessage(dispatch, "Error while adding user membership");
    }
  },


  fetchRequestsList: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchRequestsList });

    try {
      const response = await fetch(
        `${apiUrl}/membership/requests`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchRequestsListSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchProductDetailsFailed,
          error: "Error while fetching pending requests",
        });
      }
      dispatch({
        type: actionDescriptors.fetchRequestsListFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchRequestsListFailed,
        error: "Error while fetching pending requests",
      });
    }
  },

  fetchApprovedUsersList: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchApprovedUsersList });

    try {
      const response = await fetch(
        `${apiUrl}/membership`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchApprovedUsersListSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchProductDetailsFailed,
          error: "Error while fetching approved users list",
        });
      }
      dispatch({
        type: actionDescriptors.fetchApprovedUsersListFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchApprovedUsersListFailed,
        error: "Error while fetching approved users list",
      });
    }
  },

  approveRejectMembershipRequest: async (dispatch, payload, index) => {
    dispatch({ type: actionDescriptors.approveRejectMembershipRequest, index: index, value: payload.userMembershipEvent });

    try {
      const response = await fetch(
        `${apiUrl}/membership/requests`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.approveRejectMembershipRequestSuccessful,
          payload: {...body.data, index: index}
        });
        actions.setMessage(dispatch, "Membership request has been updated", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchProductDetailsFailed,
          error: "Error while while updating user membership request status",
        });
        actions.setMessage(dispatch, "Error while while updating user membership request status");
        return false;;
      }
      dispatch({
        type: actionDescriptors.approveRejectMembershipRequestFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.approveRejectMembershipRequestFailed,
        error: "Error while while updating user membership request status",
      });
      actions.setMessage(dispatch, "Error while while updating user membership request status");
    }
  }
};

export { actionDescriptors, actions };
