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
  updateOffer: "update_offer",
  updateOfferSuccessful: "update_offer_successful",
  updateOfferFailed: "update_offer_failed",
  acceptOffer: "accept_offer",
  rejectOffer: "reject_offer",
  cancelOffer: "cancel_offer",
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
      // Log and handle the error
      console.error("Error while creating offer:", err);
  
      dispatch({
        type: actionDescriptors.createOfferFailed,
        error: err.message || "Error while creating offer",
      });
      actions.setMessage(dispatch, err.message || "Error while creating offer");
  
      // Re-throw the error so it can be caught in the calling code
      throw err;
    }
  },
  

  fetchOffers: async (dispatch, productAddress = null, userAddress = null) => {
    dispatch({ type: actionDescriptors.fetchOffers });

    try {
      // Fetch offers for specific product (For product details page)
      if (productAddress) {
        const response = await fetch(`${apiUrl}/offer?assetToBeSold=${productAddress}`, {
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

  updateOffer: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateOffer });

    try {
      const response = await fetch(`${apiUrl}/offer/update`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
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

      dispatch({
        type: actionDescriptors.updateOfferFailed,
        error: "Error while updating offer",
      });
      actions.setMessage(dispatch, "Error while updating offer");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateOfferFailed,
        error: "Error while updating offer",
      });
      actions.setMessage(dispatch, "Error while updating offer");
    }
  },

  acceptOffer: async (dispatch, address) => {
    try {
      const response = await fetch(`${apiUrl}/offer/accept`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      if (response.status === RestStatus.OK) {
        dispatch({ type: actionDescriptors.acceptOffer, address });
      }
    } catch (err) {
      console.error("Error accepting offer:", err);
    }
  },

  rejectOffer: async (dispatch, address) => {
    try {
      const response = await fetch(`${apiUrl}/offer/reject`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      if (response.status === RestStatus.OK) {
        dispatch({ type: actionDescriptors.rejectOffer, address });
      }
    } catch (err) {
      console.error("Error rejecting offer:", err);
    }
  },

  cancelOffer: async (dispatch, address) => {
    try {
      const response = await fetch(`${apiUrl}/offer/cancel`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      if (response.status === RestStatus.OK) {
        dispatch({ type: actionDescriptors.cancelOffer, address });
      }
    } catch (err) {
      console.error("Error canceling offer:", err);
    }
  },
};

export { actionDescriptors, actions };
