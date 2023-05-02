import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createCategory: "create_category",
  createCategorySuccessful: "create_category_successful",
  createCategoryFailed: "create_category_failed",
  fetchCategory: "fetch_categorys",
  fetchCategorySuccessful: "fetch_category_successful",
  fetchCategoryFailed: "fetch_category_failed",
  fetchCategoryDetails: "fetch_category_details",
  fetchCategoryDetailsSuccessful: "fetch_category_details_successful",
  fetchCategoryDetailsFailed: "fetch_category_details_failed",
  transferCategoryOwnership: "transfer_category_ownership",
  transferCategoryOwnershipSuccessful: "transfer_category_ownership_successful",
  transferCategoryOwnershipFailed: "transfer_category_ownership_failed",
  updateCategory: "update_category",
  updateCategorySuccessful: "update_category_successful",
  updateCategoryFailed: "update_category_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchCategoryAudit: "fetch_category_audit",
  fetchCategoryAuditSuccessful: "fetch_category_audit_successful",
  fetchCategoryAuditFailed: "fetch_category_audit_failed",
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

  createCategory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createCategory });

    try {
      const response = await fetch(`${apiUrl}/category`, {
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
          type: actionDescriptors.createCategorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Category created successfully", true)
        return true;
      }

      dispatch({ type: actionDescriptors.createCategoryFailed, error: 'Error while creating Category' });
      actions.setMessage(dispatch, "Error while creating Category")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createCategoryFailed, error: "Error while creating Category" });
      actions.setMessage(dispatch, "Error while creating Category")
    }
  },

  fetchCategoryDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchCategoryDetails });

    try {
      const response = await fetch(`${apiUrl}/category/${id}/${chainId}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchCategoryDetailsSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchCategoryDetailsFailed, error: 'Error while fetching Category' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchCategoryDetailsFailed, error: "Error while fetching Category" });
    }
  },

  fetchCategory: async (dispatch) => {

    dispatch({ type: actionDescriptors.fetchCategory });

    try {
      const response = await fetch(`${apiUrl}/category`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchCategorySuccessful,
          payload: body.data,
        });
        return;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.fetchCategoryFailed, error: "Error while fetching category" });
        return false;
      }

      dispatch({ type: actionDescriptors.fetchCategoryFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchCategoryFailed,  error: "Error while fetching category" });
    }
  },
  transferCategoryOwnership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferCategoryOwnership });

    try {
      const response = await fetch(`${apiUrl}/category/transferOwnership`, {
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
          type: actionDescriptors.transferCategoryOwnershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been transferred", true);
        return true;
      }

      dispatch({ type: actionDescriptors.transferCategoryOwnershipFailed, error: 'Error while transfer ownership Category' });
      actions.setMessage(dispatch, "Error while transfer ownership Category")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.transferCategoryOwnershipFailed, error: "Error while transfer ownership Category" });
      actions.setMessage(dispatch, "Error while transfer ownership Category")
    }
  },
  updateCategory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateCategory });

    try {
      const response = await fetch(`${apiUrl}/category/update`, {
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
          type: actionDescriptors.updateCategorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been updated", true);
        return true;
      }

      dispatch({ type: actionDescriptors.updateCategoryFailed, error: 'Error while updating Category' });
      actions.setMessage(dispatch, "Error while updating Category")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateCategoryFailed, error: "Error while updating Category" });
      actions.setMessage(dispatch, "Error while updating Category")
    }
  },
  fetchCategoryAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchCategoryDetails });

    try {
      const response = await fetch(`${apiUrl}/category/${address}/${chainId}/audit`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchCategoryAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchCategoryAuditFailed, error: 'Error while fetching audit' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchCategoryAuditFailed, error: "Error while fetching audit" });
    }
  },
  importAssets: async (dispatch, assets) => {
    dispatch({ type: actionDescriptors.importAssetRequest });
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      try {
        const response = await fetch(`${apiUrl}/category`, {
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
