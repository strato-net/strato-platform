import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  fetchMembershipOfInventory: "fetch_membership_of_inventory",
  fetchMembershipOfInventorySuccessful: "fetch_membership_of_inventory_successful",
  fetchMembershipOfInventoryFailed: "fetch_membership_of_inventory_failed",
};

const actions = {

  fetchMembershipOfInventory: async (dispatch, limit, offset, queryValue, membershipId) => {
    const query = queryValue
      ? `&serviceTypeId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchMembershipOfInventory });

    try {
      //would use membershipId here
      const response = await fetch(`${apiUrl}/membership/1ed714e2661de2678f934ee8e6c30d3df58021b0?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();
      console.log("fetchMembershipOfInventory response: ", body.data)
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchMembershipOfInventorySuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchMembershipOfInventoryFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchMembershipOfInventoryFailed, error: undefined });
    }
  },
};

export { actionDescriptors, actions };
