import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  createProduct: 'create_product',
  createProductSuccessful: 'create_product_successful',
  createProductFailed: 'create_product_failed',
  fetchProduct: 'fetch_products',
  fetchProductSuccessful: 'fetch_product_successful',
  fetchProductFailed: 'fetch_product_failed',
  fetchProductsForFilter: 'fetch_products_for_filter',
  fetchProductsForFilterSuccessful: 'fetch_products_for_filter_successful',
  fetchProductsForFilterFailed: 'fetch_products_for_filter_failed',
  fetchCategoryBasedProduct: 'fetch_category_based_products',
  fetchCategoryBasedProductSuccessful:
    'fetch_category_based_product_successful',
  fetchCategoryBasedProductFailed: 'fetch_category_based_product_failed',
  fetchProductDetails: 'fetch_product_details',
  fetchProductDetailsSuccessful: 'fetch_product_details_successful',
  fetchProductDetailsFailed: 'fetch_product_details_failed',
  uploadImage: 'upload_image',
  uploadImageSuccessful: 'upload_image_successful',
  uploadImageFailed: 'upload_image_failed',
  updateImage: 'update_image',
  updateImageSuccessful: 'update_image_successful',
  updateImageFailed: 'update_image_failed',
  updateProduct: 'update_product',
  updateProductSuccessful: 'update_product_successful',
  updateProductFailed: 'update_product_failed',
  deleteProduct: 'delete_product',
  deleteProductSuccessful: 'delete_product_successful',
  deleteProductFailed: 'delete_product_failed',
  deleteProductConflict: 'delete_product_conflict',
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

  createProduct: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createProduct });
    try {
      const response = await fetch(`${apiUrl}/product`, {
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
          type: actionDescriptors.createProductSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Product created successfully', true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.createProductFailed,
          error: 'Error while creating Product',
        });
        actions.setMessage(dispatch, 'Error while creating Product');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createProductFailed,
          error: 'Unauthorized while creating Product',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.createProductFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createProductFailed,
        error: 'Error while creating Product',
      });
      actions.setMessage(dispatch, 'Error while creating Product');
    }
  },

  fetchProductDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchProductDetails });

    try {
      const response = await fetch(`${apiUrl}/product/${id}/${chainId}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchProductDetailsSuccessful,
          payload: body.data,
        });

        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchProductDetailsFailed,
          error: 'Error while fetching Product Details',
        });
        return false;
      }

      dispatch({
        type: actionDescriptors.fetchProductDetailsFailed,
        error: body.error,
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchProductDetailsFailed,
        error: 'Error while fetching Product Details',
      });
    }
  },

  fetchProduct: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue
      ? `&queryValue=${queryValue}&queryFields=name`
      : '';

    dispatch({ type: actionDescriptors.fetchProduct });

    try {
      const response = await fetch(
        `${apiUrl}/product?isDeleted=false&limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchProductSuccessful,
          payload: {
            data: body.data.productsWithImageUrl,
            count: body.data.count,
          },
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchProductFailed,
          error: 'Error while fetching product list',
        });
      }
      dispatch({
        type: actionDescriptors.fetchProductFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchProductFailed,
        error: 'Error while fetching product list',
      });
    }
  },

  uploadImage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.uploadImage });

    try {
      const response = await fetch(`${apiUrl}/Image`, {
        method: HTTP_METHODS.POST,
        body: payload,
      });

      const body = await response.json();

      if (response.status === RestStatus.CREATED) {
        dispatch({
          type: actionDescriptors.uploadImageSuccessful,
          payload: body.data,
        });
        // actions.setMessage(dispatch, "Image uploaded successfully", true);
        return body.data;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.uploadImageFailed,
          error: 'Image upload failed',
        });
        actions.setMessage(dispatch, 'Error while uploading Image');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.uploadImageFailed,
          error: 'Unauthorized while Image upload',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.uploadImageFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.uploadImageFailed,
        error: 'Image upload failed',
      });
      actions.setMessage(dispatch, 'Error while uploading Image');
    }
  },

  updateProduct: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateProduct });

    try {
      const response = await fetch(`${apiUrl}/product/update`, {
        method: HTTP_METHODS.PUT,
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
          type: actionDescriptors.updateProductSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Product has been updated', true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateProductFailed,
          error: 'Error while updating Product',
        });
        actions.setMessage(dispatch, 'Error while updating Product');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.updateProductFailed,
          error: 'Unauthorized while updating Product',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateProductFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, 'Error while updating Product');
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateProductFailed,
        error: 'Error while updating Product',
      });
      actions.setMessage(dispatch, 'Error while updating Product');
    }
  },

  deleteProduct: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.deleteProduct });

    try {
      const response = await fetch(`${apiUrl}/product/delete`, {
        method: HTTP_METHODS.PUT,
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
          type: actionDescriptors.deleteProductSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Product has been deleted', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.deleteProductConflict,
        });
        actions.setMessage(
          dispatch,
          'Product with inventories cannot be deleted',
          true
        );
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.deleteProductFailed,
          error: 'Error while deleting Product',
        });
        actions.setMessage(dispatch, 'Error while deleting Product');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.deleteProductFailed,
          error: 'Unauthorized while deleting Product',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.deleteProductFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.deleteProductFailed,
        error: 'Error while deleting Product',
      });
      actions.setMessage(dispatch, 'Error while deleting Product');
    }
  },

  fetchCategoryBasedProduct: async (dispatch, category, subCategory) => {
    dispatch({ type: actionDescriptors.fetchCategoryBasedProduct });

    try {
      const response = await fetch(
        `${apiUrl}/product?isActive=true&isDeleted=false&category=${category}&subCategory=${subCategory}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchCategoryBasedProductSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchCategoryBasedProductFailed,
          error: 'Error while fetching products',
        });
      }

      dispatch({
        type: actionDescriptors.fetchCategoryBasedProductFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchCategoryBasedProductFailed,
        error: 'Error while fetching products',
      });
    }
  },

  updateImage: async (dispatch, payload, fileKey) => {
    dispatch({ type: actionDescriptors.updateImage });

    try {
      const response = await fetch(`${apiUrl}/Image/${fileKey}`, {
        method: HTTP_METHODS.PUT,
        body: payload,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateImageSuccessful,
          payload: body.data,
        });
        // actions.setMessage(dispatch, "Image updated successfully", true);
        return body.data;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateImageFailed,
          error: 'Image update failed',
        });
        actions.setMessage(dispatch, 'Error while updating Image');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.updateImageFailed,
          error: 'Unauthorized while Image Update',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateImageFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateImageFailed,
        error: 'Image update failed',
      });
      actions.setMessage(dispatch, 'Error while updating Image');
    }
  },

  fetchProductsForFilter: async (dispatch, categorys, subCategorys) => {
    dispatch({ type: actionDescriptors.fetchProductsForFilter });

    const categoryQuery = categorys ? `&category[]=${categorys}` : '';

    const subCategoryQuery = subCategorys
      ? `&subCategory[]=${subCategorys}`
      : '';
    try {
      const response = await fetch(
        `${apiUrl}/product/filter/names?isDeleted=false&${categoryQuery}${subCategoryQuery}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchProductsForFilterSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchProductsForFilterFailed,
          error: 'Error while fetching products',
        });
      }

      dispatch({
        type: actionDescriptors.fetchProductsForFilterFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchProductsForFilterFailed,
        error: 'Error while fetching products',
      });
    }
  },
};

export { actionDescriptors, actions };
