import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  createSubCategory: 'create_subCategory',
  createSubCategorySuccessful: 'create_subCategory_successful',
  createSubCategoryFailed: 'create_subCategory_failed',
  fetchSubCategory: 'fetch_subCategorys',
  fetchSubCategorySuccessful: 'fetch_subCategory_successful',
  fetchSubCategoryFailed: 'fetch_subCategory_failed',
  resetMessage: 'reset_message',
  setMessage: 'set_message',
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  createSubCategory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createSubCategory });

    try {
      const response = await fetch(`${apiUrl}/subCategory`, {
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
          type: actionDescriptors.createSubCategorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'SubCategory created successfully', true);
        return true;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createSubCategoryFailed,
          error: 'Unauthorized while fetching category',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.createSubCategoryFailed,
        error: 'Error while creating SubCategory',
      });
      actions.setMessage(dispatch, 'Error while creating SubCategory');
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createSubCategoryFailed,
        error: 'Error while creating SubCategory',
      });
      actions.setMessage(dispatch, 'Error while creating SubCategory');
    }
  },

  fetchSubCategory: async (dispatch, category) => {
    dispatch({ type: actionDescriptors.fetchSubCategory });

    try {
      const response = await fetch(
        `${apiUrl}/subcategory?category=${category}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSubCategorySuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchSubCategoryFailed,
          error: 'Error while fetching sub-category',
        });
      }

      dispatch({
        type: actionDescriptors.fetchSubCategoryFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchSubCategoryFailed,
        error: 'Error while fetching sub-category',
      });
    }
  },
  fetchSubCategoryList: async (dispatch, categories) => {
    dispatch({ type: actionDescriptors.fetchSubCategory });

    try {
      const response = await fetch(
        `${apiUrl}/subcategory?category[]=${categories}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSubCategorySuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchSubCategoryFailed,
          error: 'Error while fetching sub-category list',
        });
      }
      dispatch({
        type: actionDescriptors.fetchSubCategoryFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchSubCategoryFailed,
        error: 'Error while fetching sub-category list',
      });
    }
  },
};

export { actionDescriptors, actions };
