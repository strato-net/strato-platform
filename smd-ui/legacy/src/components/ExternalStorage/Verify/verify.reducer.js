import {
  OPEN_VERIFY_MODAL, CLOSE_VERIFY_MODAL, VERIFY_DOCUMENT_REQUEST, VERIFY_DOCUMENT_SUCCESS, VERIFY_DOCUMENT_FAILURE, RESET_ERROR
} from "./verify.actions";

const initialState = {
  isOpen: false,
  verifyDocument: null,
  error: null
}

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_VERIFY_MODAL:
      return {
        ...state,
        isOpen: true
      }
    case CLOSE_VERIFY_MODAL:
      return {
        ...state,
        isOpen: false,
        verifyDocument: null
      }
    case VERIFY_DOCUMENT_REQUEST:
      return {
        ...state,
        isLoading: true
      }
    case VERIFY_DOCUMENT_SUCCESS:
      return {
        ...state,
        isLoading: false,
        verifyDocument: action.data,
        error: null
      }
    case VERIFY_DOCUMENT_FAILURE:
      return {
        ...state,
        isLoading: false,
        verifyDocument: null,
        error: action.error
      }
    case RESET_ERROR:
      return {
        ...state,
        error: null
      }
    default:
      return state;
  }
}

export default reducer;