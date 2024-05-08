import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
    setMessage: "set_message",
    resetMessage: "reset_message",
    requestReview: "request_review",
    requestReviewSuccessful: "request_review_success",
    requestReviewFailed: "request_review_failed",
    authorizeSeller: "authorize_seller",
    authorizeSellerSuccessful: "authorize_seller_success",
    authorizeSellerFailed: "athorize_seller_failed",  
    deauthorizeSeller: "deauthorize_seller",
    deauthorizeSellerSuccessful: "deauthorize_seller_success",
    deauthorizeSellerFailed: "deathorize_seller_failed",  
};

const actions = {
    resetMessage: (dispatch) => {
        dispatch({ type: actionDescriptors.resetMessage });
    },
    setMessage: (dispatch, message, success = false) => {
        dispatch({ type: actionDescriptors.setMessage, message, success });
    },
    requestReview: async (dispatch, payload) => {
        dispatch({type: actionDescriptors.requestReview});
        try {
            console.log('AYAS LOGS - payload in actions', payload);
            const response = await fetch(`${apiUrl}/sellerstatus/requestReview`, {
                method: HTTP_METHODS.POST,
                credentials: "same-origin",
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const body = await response.json();
            if (response.status == RestStatus.OK) {
                dispatch({type: actionDescriptors.requestReviewSuccessful});
                actions.setMessage(dispatch, "Successfully requested review", true);
                return body;
            } else {
                dispatch({type: actionDescriptors.requestReviewFailed});
                actions.setMessage(dispatch, body.error, false);
            }
        } catch (e) {
            dispatch({type: actionDescriptors.requestReviewFailed});
            actions.setMessage(dispatch, "Error occurred while requesting review: " + e.message, false);
        }
    },
    authorizeSeller: async (dispatch, payload) => {
        dispatch({ type: actionDescriptors.authorizeSeller,});
        try {
            const response = await fetch(`${apiUrl}/sellerstatus/authorizeSeller`, {
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
                dispatch({ type: actionDescriptors.authorizeSellerSuccessful, payload: body.data });
                actions.setMessage(dispatch, "Successfully authorized seller", true);
                return body;
            } else {
                dispatch({ type: actionDescriptors.authorizeSellerFailed });
                actions.setMessage(dispatch, body.error, false);
            }
        } catch (err) {
            dispatch({ type: actionDescriptors.authorizeSellerFailed });
            actions.setMessage(dispatch, err.message, false);
        }
    },
    deauthorizeSeller: async (dispatch, payload) => {
        dispatch({ type: actionDescriptors.deauthorizeSeller,});
        try {
            const response = await fetch(`${apiUrl}/sellerstatus/deauthorizeSeller`, {
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
                dispatch({ type: actionDescriptors.deauthorizeSellerSuccessful, payload: body.data });
                actions.setMessage(dispatch, "Successfully deauthorized seller", true);
                return body;
            } else {
                dispatch({ type: actionDescriptors.deauthorizeSellerFailed });
                actions.setMessage(dispatch, body.error, false);
            }
        } catch (err) {
            dispatch({ type: actionDescriptors.deauthorizeSellerFailed });
            actions.setMessage(dispatch, err.message, false);
        }
    },
}

export { actionDescriptors, actions };