import { OPEN_UPLOAD_MODAL, CLOSE_UPLOAD_MODAL, UPLOAD_FILE_SUCCESS, UPLOAD_FILE_FAILURE, RESET_UPLOAD_ERROR, USERNAME_FORM_CHANGE, UPLOAD_FILE_REQUEST } from "./uploadFile.actions";

const initialState = {
  isOpen: false,
  result: null,
  error: null,
  username: null,
  isLoading: false
}

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_UPLOAD_MODAL:
      return {
        ...state,
        isOpen: true
      }
    case CLOSE_UPLOAD_MODAL:
      return {
        ...state,
        isOpen: false,
        result: null,
        error: null
      }
    case UPLOAD_FILE_REQUEST:
      return {
        ...state,
        isLoading: true
      }
    case UPLOAD_FILE_SUCCESS:
      return {
        ...state,
        result: action.result,
        error: null,
        isLoading: false
      }
    case UPLOAD_FILE_FAILURE:
      return {
        ...state,
        result: null,
        error: action.error,
        isLoading: false
      }
    case RESET_UPLOAD_ERROR:
      return {
        ...state,
        error: null
      }
    case USERNAME_FORM_CHANGE:
      return {
        ...state,
        username: action.name
      }
    default:
      return state;
  }
}

export default reducer;