import { FETCH_UPLOAD_LIST_SUCCESS, FETCH_UPLOAD_LIST_FAILURE } from "./externalStorage.actions";

const initialState = {
  error: null,
  uploadList: []
}

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_UPLOAD_LIST_SUCCESS:
      return {
        ...state,
        uploadList: action.uploadList,
        error: null
      }
    case FETCH_UPLOAD_LIST_FAILURE:
      return {
        ...state,
        uploadList: [],
        error: action.error
      }
    default:
      return state
  }
}

export default reducer;