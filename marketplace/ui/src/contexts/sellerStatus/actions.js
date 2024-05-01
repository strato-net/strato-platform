import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
    requestReview: "request_review",
    requestReviewSuccessful: "request_review_success",
    requestReviewFailed: "request_review_failed",
    authorizeSeller: "authorize_seller",
    authorizeSellerSuccessful: "authorize_seller_success",
    authorizeSellerFailed: "athorize_seller_failed",  
};

const actions = {
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
                dispatch({type: actionDescriptors.requestReviewSuccessful})
                return body;
            } else {
                dispatch({type: actionDescriptors.requestReviewFailed})     
            }
        } catch (e) {
            dispatch({type: actionDescriptors.requestReviewFailed})
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
                return body;
            } else if(response.status === RestStatus.UNAUTHORIZED) {
                dispatch({ 
                type: actionDescriptors.authorizeSellerFailed, 
                error: "Unauthorized while logging out" 
                });
            }
            dispatch({ type: actionDescriptors.authorizeSellerFailed, payload: undefined }); //do I need payload here?
        } catch (err) {
            dispatch({ type: actionDescriptors.authorizeSellerFailed, payload: undefined });
        }
    },
}

export { actionDescriptors, actions };