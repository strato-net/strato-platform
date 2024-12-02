import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  setMessage: 'set_message',
  resetMessage: 'reset_message',
  requestReview: 'request_review',
  requestReviewSuccessful: 'request_review_success',
  requestReviewFailed: 'request_review_failed',
  authorizeIssuer: 'authorize_issuer',
  authorizeIssuerSuccessful: 'authorize_issuer_success',
  authorizeIssuerFailed: 'athorize_issuer_failed',
  deauthorizeIssuer: 'deauthorize_issuer',
  deauthorizeIssuerSuccessful: 'deauthorize_issuer_success',
  deauthorizeIssuerFailed: 'deathorize_issuer_failed',
  modifyAdmin: 'modify_admin',
  modifyAdminSuccessful: 'modify_admin_successful',
  modifyAdminFailed: 'modify_admin_failed',
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },
  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },
  requestReview: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.requestReview });
    try {
      const response = await fetch(`${apiUrl}/issuerstatus/requestReview`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (response.status == RestStatus.OK) {
        dispatch({ type: actionDescriptors.requestReviewSuccessful });
        actions.setMessage(dispatch, 'Successfully requested review', true);
        return body;
      } else {
        dispatch({ type: actionDescriptors.requestReviewFailed });
        actions.setMessage(dispatch, body.error, false);
      }
    } catch (e) {
      dispatch({ type: actionDescriptors.requestReviewFailed });
      actions.setMessage(
        dispatch,
        'Error occurred while requesting review: ' + e.message,
        false
      );
    }
  },
  authorizeIssuer: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.authorizeIssuer });
    try {
      const response = await fetch(`${apiUrl}/issuerstatus/authorizeIssuer`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.authorizeIssuerSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Successfully authorized issuer', true);
        return body;
      } else {
        dispatch({ type: actionDescriptors.authorizeIssuerFailed });
        actions.setMessage(dispatch, body.error, false);
      }
    } catch (err) {
      dispatch({ type: actionDescriptors.authorizeIssuerFailed });
      actions.setMessage(dispatch, err.message, false);
    }
  },
  deauthorizeIssuer: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.deauthorizeIssuer });
    try {
      const response = await fetch(`${apiUrl}/issuerstatus/deauthorizeIssuer`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.deauthorizeIssuerSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Successfully deauthorized issuer', true);
        return body;
      } else {
        dispatch({ type: actionDescriptors.deauthorizeIssuerFailed });
        actions.setMessage(dispatch, body.error, false);
      }
    } catch (err) {
      dispatch({ type: actionDescriptors.deauthorizeIssuerFailed });
      actions.setMessage(dispatch, err.message, false);
    }
  },
  modifyAdmin: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.modifyAdmin });
    try {
      const response = await fetch(`${apiUrl}/issuerstatus/admin`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.modifyAdminSuccessful,
          payload: body.data,
        });
        actions.setMessage(
          dispatch,
          "Successfully updated user's admin status",
          true
        );
        return body;
      } else {
        dispatch({ type: actionDescriptors.modifyAdminFailed });
        actions.setMessage(dispatch, body.error, false);
      }
    } catch (err) {
      dispatch({ type: actionDescriptors.modifyAdminFailed });
      actions.setMessage(dispatch, err.message, false);
    }
  },
};

export { actionDescriptors, actions };
