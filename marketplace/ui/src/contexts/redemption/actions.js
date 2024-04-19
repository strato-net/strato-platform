import RestStatus from "http-status-codes";
import { apiUrl, fileServerUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
    resetMessage: "reset_message",
    setMessage: "set_message",
    requestRedemption: "request_redemption",
    requestRedemptionSuccessful: "request_redemption_successful",
    requestRedemptionFailed: "request_redemption_failed",
    fetchOutgoingRedemptionRequests: "fetch_outgoing_redemption_requests",
    fetchOutgoingRedemptionRequestsSuccessful: "fetch_outgoing_redemption_requests_successful",
    fetchOutgoingRedemptionRequestsFailed: "fetch_outgoing_redemption_requests_failed",
    fetchIncomingRedemptionRequests: "fetch_incoming_redemption_requests",
    fetchIncomingRedemptionRequestsSuccessful: "fetch_incoming_redemption_requests_successful",
    fetchIncomingRedemptionRequestsFailed: "fetch_incoming_redemption_requests_failed",
    fetchRedemptionDetails: "fetch_redemption_details",
    fetchRedemptionDetailsSuccessful: "fetch_redemption_details_successful",
    fetchRedemptionDetailsFailed: "fetch_redemption_details_failed",
    closeRedemption: "close_redemption",
    closeRedemptionSuccessful: "close_redemption_successful",
    closeRedemptionFailed: "close_redemption_failed",
};

const actions = {
    resetMessage: (dispatch) => {
        dispatch({ type: actionDescriptors.resetMessage });
    },

    setMessage: (dispatch, message, success = false) => {
        dispatch({ type: actionDescriptors.setMessage, message, success });
    },

    requestRedemption: async (dispatch, payload) => {
        dispatch({ type: actionDescriptors.requestRedemption });

        try {
            const response = await fetch(`${apiUrl}/redemption`, {
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
                    type: actionDescriptors.requestRedemptionSuccessful,
                    payload: body.data,
                });
                actions.setMessage(dispatch, "Request for redemption sent", true);
                return true;
            } else if (response.status === RestStatus.CONFLICT) {
                dispatch({ type: actionDescriptors.requestRedemptionFailed, error: body.error.message });
                actions.setMessage(dispatch, body.error.message)
                return false;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({ type: actionDescriptors.requestRedemptionFailed, error: "Error while redeeming Item" });
                actions.setMessage(dispatch, "Error while redeeming Item")
                return false;
            } else if (response.status === RestStatus.UNAUTHORIZED) {
                dispatch({
                    type: actionDescriptors.requestRedemptionFailed,
                    error: "Unauthorized while redeeming Item"
                });
                window.location.href = body.error.loginUrl;
            }

            dispatch({
                type: actionDescriptors.requestRedemptionFailed,
                error: body.error
            });
            actions.setMessage(dispatch, body.error);
            return false;
        } catch (err) {
            dispatch({
                type: actionDescriptors.requestRedemptionFailed,
                error: "Error while redeeming Item",
            });
            actions.setMessage(dispatch, "Error while redeeming Item");
        }
    },

    fetchOutgoingRedemptionRequests: async (dispatch) => {
        dispatch({ type: actionDescriptors.fetchOutgoingRedemptionRequests });

        try {
            const response = await fetch(`${apiUrl}/redemption/outgoing`, {
                method: HTTP_METHODS.GET,
            });

            const body = await response.json();

            if (response.status === RestStatus.OK) {
                dispatch({
                    type: actionDescriptors.fetchOutgoingRedemptionRequestsSuccessful,
                    payload: body.data,
                });
                return true;
            } else if (response.status === RestStatus.CONFLICT) {
                dispatch({ type: actionDescriptors.fetchOutgoingRedemptionRequestsFailed, error: body.error.message });
                actions.setMessage(dispatch, body.error.message)
                return false;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({ type: actionDescriptors.fetchOutgoingRedemptionRequestsFailed, error: "Error while fetching outgoing Redemption Requests" });
                actions.setMessage(dispatch, "Error while fetching outgoing Redemption Requests")
                return false;
            } else if (response.status === RestStatus.UNAUTHORIZED) {
                dispatch({
                    type: actionDescriptors.fetchOutgoingRedemptionRequestsFailed,
                    error: "Unauthorized while fetching outgoing Redemption Requests"
                });
                window.location.href = body.error.loginUrl;
            }

            dispatch({
                type: actionDescriptors.fetchOutgoingRedemptionRequestsFailed,
                error: body.error
            });
            actions.setMessage(dispatch, body.error);
            return false;
        } catch (err) {
            dispatch({
                type: actionDescriptors.fetchOutgoingRedemptionRequestsFailed,
                error: "Error while fetching outgoing Redemption Requests",
            });
            actions.setMessage(dispatch, "Error while fetching outgoing Redemption Requests");
        }
    },

    fetchIncomingRedemptionRequests: async (dispatch) => {
        dispatch({ type: actionDescriptors.fetchIncomingRedemptionRequests });

        try {
            const response = await fetch(`${apiUrl}/redemption/incoming`, {
                method: HTTP_METHODS.GET,
            });

            const body = await response.json();

            if (response.status === RestStatus.OK) {
                dispatch({
                    type: actionDescriptors.fetchIncomingRedemptionRequestsSuccessful,
                    payload: body.data,
                });
                return true;
            } else if (response.status === RestStatus.CONFLICT) {
                dispatch({ type: actionDescriptors.fetchIncomingRedemptionRequestsFailed, error: body.error.message });
                actions.setMessage(dispatch, body.error.message)
                return false;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({ type: actionDescriptors.fetchIncomingRedemptionRequestsFailed, error: "Error while fetching incoming Redemptions Requests" });
                actions.setMessage(dispatch, "Error while fetching incoming Redemptions Requests")
                return false;
            } else if (response.status === RestStatus.UNAUTHORIZED) {
                dispatch({
                    type: actionDescriptors.fetchIncomingRedemptionRequestsFailed,
                    error: "Unauthorized while fetching incoming Redemptions Requests"
                });
                window.location.href = body.error.loginUrl;
            }

            dispatch({
                type: actionDescriptors.fetchIncomingRedemptionRequestsFailed,
                error: body.error
            });
            actions.setMessage(dispatch, body.error);
            return false;
        } catch (err) {
            dispatch({
                type: actionDescriptors.fetchIncomingRedemptionRequestsFailed,
                error: "Error while fetching incoming Redemptions Requests",
            });
            actions.setMessage(dispatch, "Error while fetching incoming Redemptions Requests");
        }
    },

    fetchRedemptionDetail: async (dispatch, id) => {
        dispatch({ type: actionDescriptors.fetchRedemptionDetails });

        try {
            const response = await fetch(`${apiUrl}/redemption/${id}`, {
                method: HTTP_METHODS.GET,
            });

            const body = await response.json();

            if (response.status === RestStatus.OK) {
                dispatch({
                    type: actionDescriptors.fetchRedemptionDetailsSuccessful,
                    payload: body.data,
                });

                return true;
            } else if (response.status === RestStatus.UNAUTHORIZED) {
                dispatch({
                    type: actionDescriptors.fetchRedemptionDetailsFailed,
                    error: "Unauthorized while fetching Redemption details"
                });
                window.location.href = body.error.loginUrl;
            }

            dispatch({
                type: actionDescriptors.fetchRedemptionDetailsFailed,
                error: "Error while fetching Redemption details",
            });
            return false;
        } catch (err) {
            dispatch({
                type: actionDescriptors.fetchRedemptionDetailsFailed,
                error: "Error while fetching Redemption details",
            });
        }
    },

    closeRedemption: async (dispatch, payload) => {
        dispatch({ type: actionDescriptors.closeRedemption });

        try {
            const response = await fetch(`${apiUrl}/redemption/close`, {
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
                    type: actionDescriptors.closeRedemptionSuccessful,
                    payload: body.data,
                });
                actions.setMessage(dispatch, "Closed redemption successfully", true);
                return true;
            } else if (response.status === RestStatus.CONFLICT) {
                dispatch({ type: actionDescriptors.closeRedemptionFailed, error: body.error.message });
                actions.setMessage(dispatch, body.error.message)
                return false;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({ type: actionDescriptors.closeRedemptionFailed, error: "Error while closing Redemption" });
                actions.setMessage(dispatch, "Error while closing Redemption")
                return false;
            } else if (response.status === RestStatus.UNAUTHORIZED) {
                dispatch({
                    type: actionDescriptors.closeRedemptionFailed,
                    error: "Unauthorized while closing Redemption"
                });
                window.location.href = body.error.loginUrl;
            }

            dispatch({
                type: actionDescriptors.closeRedemptionFailed,
                error: body.error
            });
            actions.setMessage(dispatch, body.error);
            return false;
        } catch (err) {
            dispatch({
                type: actionDescriptors.closeRedemptionFailed,
                error: "Error while closing Redemption",
            });
            actions.setMessage(dispatch, "Error while closing Redemption");
        }
    },
};

export { actionDescriptors, actions };