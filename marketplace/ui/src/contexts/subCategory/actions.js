import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createSubCategory: "create_subCategory",
  createSubCategorySuccessful: "create_subCategory_successful",
  createSubCategoryFailed: "create_subCategory_failed",
  fetchSubCategory: "fetch_subCategorys",
  fetchSubCategorySuccessful: "fetch_subCategory_successful",
  fetchSubCategoryFailed: "fetch_subCategory_failed",
  fetchSubCategoryDetails: "fetch_subCategory_details",
  fetchSubCategoryDetailsSuccessful: "fetch_subCategory_details_successful",
  fetchSubCategoryDetailsFailed: "fetch_subCategory_details_failed",
  transferSubCategoryOwnership: "transfer_subCategory_ownership",
  transferSubCategoryOwnershipSuccessful: "transfer_subCategory_ownership_successful",
  transferSubCategoryOwnershipFailed: "transfer_subCategory_ownership_failed",
  updateSubCategory: "update_subCategory",
  updateSubCategorySuccessful: "update_subCategory_successful",
  updateSubCategoryFailed: "update_subCategory_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchSubCategoryAudit: "fetch_subCategory_audit",
  fetchSubCategoryAuditSuccessful: "fetch_subCategory_audit_successful",
  fetchSubCategoryAuditFailed: "fetch_subCategory_audit_failed",
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

  createSubCategory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createSubCategory });

    try {
      const response = await fetch(`${apiUrl}/subCategory`, {
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
          type: actionDescriptors.createSubCategorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "SubCategory created successfully", true)
        return true;
      }

      dispatch({ type: actionDescriptors.createSubCategoryFailed, error: 'Error while creating SubCategory' });
      actions.setMessage(dispatch, "Error while creating SubCategory")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createSubCategoryFailed, error: "Error while creating SubCategory" });
      actions.setMessage(dispatch, "Error while creating SubCategory")
    }
  },

  fetchSubCategoryDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchSubCategoryDetails });

    try {
      const response = await fetch(`${apiUrl}/subCategory/${id}/${chainId}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSubCategoryDetailsSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchSubCategoryDetailsFailed, error: 'Error while fetching SubCategory' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchSubCategoryDetailsFailed, error: "Error while fetching SubCategory" });
    }
  },

  fetchSubCategory: async (dispatch, categoryId) => {

    dispatch({ type: actionDescriptors.fetchSubCategory });

    try {
      const response = await fetch(`${apiUrl}/subcategory?categoryId=${categoryId}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSubCategorySuccessful,
          payload: body.data,
        });
        return;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.fetchSubCategoryFailed, error: "Error while fetching sub-category" });
      }

      dispatch({ type: actionDescriptors.fetchSubCategoryFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchSubCategoryFailed, error:  "Error while fetching sub-category" });
    }
  },
  fetchSubCategoryList: async (dispatch, categoryId) => {

    dispatch({ type: actionDescriptors.fetchSubCategory });

    try {
      const response = await fetch(`${apiUrl}/subcategory?categoryId[]=${categoryId}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSubCategorySuccessful,
          payload: body.data,
        });
        return;
      }else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.fetchSubCategoryFailed, error: "Error while fetching sub-category list" });
      }
      dispatch({ type: actionDescriptors.fetchSubCategoryFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchSubCategoryFailed, error: "Error while fetching sub-category list" });
    }
  },
  transferSubCategoryOwnership: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.transferSubCategoryOwnership });

    try {
      const response = await fetch(`${apiUrl}/subCategory/transferOwnership`, {
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
          type: actionDescriptors.transferSubCategoryOwnershipSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been transferred", true);
        return true;
      }

      dispatch({ type: actionDescriptors.transferSubCategoryOwnershipFailed, error: 'Error while transfer ownership SubCategory' });
      actions.setMessage(dispatch, "Error while transfer ownership SubCategory")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.transferSubCategoryOwnershipFailed, error: "Error while transfer ownership SubCategory" });
      actions.setMessage(dispatch, "Error while transfer ownership SubCategory")
    }
  },
  updateSubCategory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateSubCategory });

    try {
      const response = await fetch(`${apiUrl}/subCategory/update`, {
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
          type: actionDescriptors.updateSubCategorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Product has been updated", true);
        return true;
      }

      dispatch({ type: actionDescriptors.updateSubCategoryFailed, error: 'Error while updating SubCategory' });
      actions.setMessage(dispatch, "Error while updating SubCategory")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateSubCategoryFailed, error: "Error while updating SubCategory" });
      actions.setMessage(dispatch, "Error while updating SubCategory")
    }
  },
  fetchSubCategoryAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchSubCategoryDetails });

    try {
      const response = await fetch(`${apiUrl}/subCategory/${address}/${chainId}/audit`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSubCategoryAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchSubCategoryAuditFailed, error: 'Error while fetching audit' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchSubCategoryAuditFailed, error: "Error while fetching audit" });
    }
  },
  importAssets: async (dispatch, assets) => {
    dispatch({ type: actionDescriptors.importAssetRequest });
    const errors = [];

    for (let i = 0; i < assets.length; i++) {
      try {
        const response = await fetch(`${apiUrl}/subCategory`, {
          method: HTTP_METHODS.POST,
          credentials: "same-origin",
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(assets[i])
        });


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
