import { OPEN_UPLOAD_MODAL, CLOSE_UPLOAD_MODAL, UPLOAD_FILE_SUCCESS, UPLOAD_FILE_FAILURE } from "./uploadFile.actions";

const initialState = {
  isOpen: false,
  uploadedFile: null,
  error: null
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
        isOpen: false
      }
    case UPLOAD_FILE_SUCCESS:
      return {
        ...state,
      }
    case UPLOAD_FILE_FAILURE:
      return {
        ...state,
      }
    default:
      return state;
  }
}

export default reducer;