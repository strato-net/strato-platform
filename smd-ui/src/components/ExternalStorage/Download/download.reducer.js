import { OPEN_DOWNLOAD_MODAL, CLOSE_DOWNLOAD_MODAL, DOWNLOAD_FAILURE, RESET_ERROR, DOWNLOAD_SUCCESS, CLEAR_URL } from "./download.actions";

const initialState = {
  isOpen: false,
  error: null,
  url: null
}

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_DOWNLOAD_MODAL:
      return {
        ...state,
        isOpen: true
      }
    case CLOSE_DOWNLOAD_MODAL:
      return {
        ...state,
        isOpen: false
      }
    case DOWNLOAD_SUCCESS:
      return {
        ...state,
        url: action.url
      }
    case DOWNLOAD_FAILURE:
      return {
        ...state,
        error: action.error
      }
    case RESET_ERROR:
      return {
        ...state,
        error: null
      }
    case CLEAR_URL:
      return {
        ...state,
        url: null,
        error: null
      }
    default:
      return state;
  }
}

export default reducer;