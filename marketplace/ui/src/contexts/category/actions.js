import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  createCategory: 'create_category',
  createCategorySuccessful: 'create_category_successful',
  createCategoryFailed: 'create_category_failed',
  fetchCategory: 'fetch_categorys',
  fetchCategorySuccessful: 'fetch_category_successful',
  fetchCategoryFailed: 'fetch_category_failed',
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

  createCategory: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createCategory });

    try {
      const response = await fetch(`${apiUrl}/category`, {
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
          type: actionDescriptors.createCategorySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Category created successfully', true);
        return true;
      }

      dispatch({
        type: actionDescriptors.createCategoryFailed,
        error: 'Error while creating Category',
      });
      actions.setMessage(dispatch, 'Error while creating Category');
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createCategoryFailed,
        error: 'Error while creating Category',
      });
      actions.setMessage(dispatch, 'Error while creating Category');
    }
  },

  fetchCategories: async (dispatch) => {
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
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchCategoryFailed,
          error: 'Error while fetching category',
        });
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchCategoryFailed,
          error: 'Unauthorized while fetching categories',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchCategoryFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchCategoryFailed,
        error: 'Error while fetching category',
      });
    }
  },
};

export { actionDescriptors, actions };
