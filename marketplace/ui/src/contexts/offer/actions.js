import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createOffer: "create_offer",
  createOfferSuccessful: "create_offer_successful",
  createOfferFailed: "create_offer_failed",
  fetchOffers: "fetch_offers",
  fetchOffersSuccessful: "fetch_offers_successful",
  fetchOffersFailed: "fetch_offers_failed",
  fetchOffer: "fetch_offer",
  fetchOfferSuccessful: "fetch_offer_successful",
  fetchOfferFailed: "fetch_offer_failed",
  fetchIncomingOffers: "fetch_incoming_offers",
  fetchIncomingOffersSuccessful: "fetch_incoming_offers_successful",
  fetchIncomingOffersFailed: "fetch_incoming_offers_failed",
  fetchOutgoingOffers: "fetch_outgoing_offers",
  fetchOutgoingOffersSuccessful: "fetch_outgoing_offers_successful",
  fetchOutgoingOffersFailed: "fetch_outgoing_offers_failed",
  updateOffer: "update_offer",
  updateOfferSuccessful: "update_offer_successful",
  updateOfferFailed: "update_offer_failed",
  acceptOffer: "accept_offer",
  acceptOfferFailed: "accept_offer_failed",
  acceptOfferSuccessful: "accept_offer_successful",
  rejectOffer: "reject_offer",
  rejectOfferFailed: "reject_offer_failed",
  rejectOfferSuccessful: "reject_offer_successful",
  cancelOffer: "cancel_offer",
  cancelOfferFailed: "cancel_offer_failed",
  cancelOfferSuccessful: "cancel_offer_successful",
  resetMessage: "reset_message",
  setMessage: "set_message",
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  createOffer: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createOffer });

    console.log("Getting to actions ===> ", dispatch, payload);

    try {
      const response = await fetch(`${apiUrl}/offer`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      // Handle successful response
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createOfferSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Offer created successfully", true);
        return true;
      }

      const errorMessage = body?.error || "Error while creating offer";
      dispatch({
        type: actionDescriptors.createOfferFailed,
        error: errorMessage,
      });
      actions.setMessage(dispatch, errorMessage);

      throw new Error(errorMessage);
    } catch (err) {
      console.error("Error while creating offer:", err);

      dispatch({
        type: actionDescriptors.createOfferFailed,
        error: err.message || "Error while creating offer",
      });
      actions.setMessage(dispatch, err.message || "Error while creating offer");

      throw err;
    }
  },

  fetchOffers: async (dispatch, productAddress = null, userAddress = null) => {
    dispatch({ type: actionDescriptors.fetchOffers });

    try {
      // Fetch offers for specific product (For product details page)
      if (productAddress) {
        const response = await fetch(
          `${apiUrl}/offer?assetToBeSold=${productAddress}`,
          {
            method: HTTP_METHODS.GET,
          }
        );

        const body = await response.json();

        if (response.status === RestStatus.OK) {
          dispatch({
            type: actionDescriptors.fetchOffersSuccessful,
            payload: body.data,
          });
          return;
        }

        dispatch({
          type: actionDescriptors.fetchOffersFailed,
          error: body.error || "Error while fetching offers",
        });
      } else if (userAddress) {
        // Fetch Offers for User
        const response = await fetch(`${apiUrl}/offer?seller=${userAddress}`, {
          method: HTTP_METHODS.GET,
        });

        const body = await response.json();

        if (response.status === RestStatus.OK) {
          dispatch({
            type: actionDescriptors.fetchOffersSuccessful,
            payload: body.data,
          });
          return;
        }

        dispatch({
          type: actionDescriptors.fetchOffersFailed,
          error: body.error || "Error while fetching offers",
        });
      }
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchOffersFailed,
        error: "Error while fetching offers",
      });
    }
  },

  fetchOffer: async (dispatch, address) => {
    dispatch({ type: actionDescriptors.fetchOffer });

    try {
      const response = await fetch(`${apiUrl}/offer/${address}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchOfferSuccessful,
          payload: body.data,
        });
        return;
      }

      dispatch({
        type: actionDescriptors.fetchOfferFailed,
        error: body.error || "Error while fetching offer",
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchOfferFailed,
        error: "Error while fetching offer",
      });
    }
  },

  // Offers Received by User
  fetchIncomingOffers: async (dispatch, user) => {
    dispatch({ type: actionDescriptors.fetchIncomingOffers });
    console.log("Getting to fetchIncomingOffers ===> ", user);
    try {
      const response = await fetch(`${apiUrl}/offer/incomimg/${user}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchIncomingOffersSuccessful,
          payload: body.data,
        });
        return;
      }

      dispatch({
        type: actionDescriptors.fetchIncomingOffersFailed,
        error: body.error || "Error while fetching incoming offers",
      });
      throw new Error(body.error || "Error while fetching incoming offers");
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchIncomingOffersFailed,
        error: "Error while fetching incoming offers",
      });
    }
  },

  // Offers Made by User
  fetchOutgoingOffers: async (dispatch, user) => {
    dispatch({ type: actionDescriptors.fetchOutgoingOffers });
    console.log("Getting to fetchOutgoingOffers ===> ", user);
    try {
      const response = await fetch(`${apiUrl}/offer/outgoing/${user}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchOutgoingOffersSuccessful,
          payload: body.data,
        });
        return;
      }

      dispatch({
        type: actionDescriptors.fetchOutgoingOffersFailed,
        error: body.error || "Error while fetching outgoing offers",
      });
      throw new Error(body.error || "Error while fetching outgoing offers");
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchOutgoingOffersFailed,
        error: "Error while fetching outgoing offers",
      });
    }
  },

  updateOffer: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateOffer });

    try {
      const response = await fetch(`${apiUrl}/offer/update`, {
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
          type: actionDescriptors.updateOfferSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Offer updated successfully", true);
        return true;
      }

      const errorMessage = body?.error || "Error while updating offer";
      dispatch({
        type: actionDescriptors.updateOfferFailed,
        error: errorMessage,
      });
      actions.setMessage(dispatch, errorMessage);
      throw new Error(errorMessage);
    } catch (err) {
      console.error("Error while updating offer:", err);
      dispatch({
        type: actionDescriptors.updateOfferFailed,
        error: err.message || "Error while updating offer",
      });
      actions.setMessage(dispatch, err.message || "Error while updating offer");
      throw err;
    }
  },

  acceptOffer: async (dispatch, address) => {
    dispatch({ type: actionDescriptors.acceptOffer });

    try {
      const response = await fetch(`${apiUrl}/offer/accept`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.acceptOffer,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Offer accepted successfully", true);
        return true;
      }

      const errorMessage = body?.error || "Error while accepting offer";
      dispatch({
        type: actionDescriptors.acceptOfferFailed,
        error: errorMessage,
      });
      actions.setMessage(dispatch, errorMessage);
      throw new Error(errorMessage);
    } catch (err) {
      console.error("Error while accepting offer:", err);
      dispatch({
        type: actionDescriptors.acceptOfferFailed,
        error: err.message || "Error while accepting offer",
      });
      actions.setMessage(
        dispatch,
        err.message || "Error while accepting offer"
      );
      throw err;
    }
  },

  rejectOffer: async (dispatch, address) => {
    dispatch({ type: actionDescriptors.rejectOffer });

    try {
      const response = await fetch(`${apiUrl}/offer/reject`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.rejectOffer,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Offer rejected successfully", true);
        return true;
      }

      const errorMessage = body?.error || "Error while rejecting offer";
      dispatch({
        type: actionDescriptors.rejectOfferFailed,
        error: errorMessage,
      });
      actions.setMessage(dispatch, errorMessage);
      throw new Error(errorMessage);
    } catch (err) {
      console.error("Error while rejecting offer:", err);
      dispatch({
        type: actionDescriptors.rejectOfferFailed,
        error: err.message || "Error while rejecting offer",
      });
      actions.setMessage(
        dispatch,
        err.message || "Error while rejecting offer"
      );
      throw err;
    }
  },

  cancelOffer: async (dispatch, address) => {
    dispatch({ type: actionDescriptors.cancelOffer });

    try {
      const response = await fetch(`${apiUrl}/offer/cancel`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.cancelOffer,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Offer canceled successfully", true);
        return true;
      }

      const errorMessage = body?.error || "Error while canceling offer";
      dispatch({
        type: actionDescriptors.cancelOfferFailed,
        error: errorMessage,
      });
      actions.setMessage(dispatch, errorMessage);
      throw new Error(errorMessage);
    } catch (err) {
      console.error("Error while canceling offer:", err);
      dispatch({
        type: actionDescriptors.cancelOfferFailed,
        error: err.message || "Error while canceling offer",
      });
      actions.setMessage(
        dispatch,
        err.message || "Error while canceling offer"
      );
      throw err;
    }
  },
};

export { actionDescriptors, actions };
