import { OPEN_ATTEST_MODAL, CLOSE_ATTEST_MODAL, ATTEST_DOCUMENT_SUCCESS, ATTEST_DOCUMENT_FAILURE, RESET_ERROR, ATTEST_DOCUMENT_REQUEST, USERNAME_FORM_CHANGE } from "./attest.actions";

const initialState = {
  isOpen: false,
  attestDocument: null,
  error: null,
  isLoading: false,
  username: null
}

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_ATTEST_MODAL:
      return {
        ...state,
        isOpen: true
      }
    case CLOSE_ATTEST_MODAL:
      return {
        ...state,
        attestDocument: null,
        isOpen: false,
        username: null
      }
    case ATTEST_DOCUMENT_REQUEST:
      return {
        ...state,
        isLoading: true
      }
    case ATTEST_DOCUMENT_SUCCESS:
      return {
        ...state,
        isLoading: false,
        attestDocument: action.data,
        error: null
      }
    case ATTEST_DOCUMENT_FAILURE:
      return {
        ...state,
        isLoading: false,
        attestDocument: null,
        error: action.error
      }
    case USERNAME_FORM_CHANGE:
      return {
        ...state,
        username: action.username
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