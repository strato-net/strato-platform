import {
  CLEAR_QUERY_STRING,
  QUERY_CIRRUS,
  QUERY_CIRRUS_SUCCESS,
  QUERY_CIRRUS_FAILURE
} from './contractQuery.actions';

const initialState = {
  queryString: '',
  queryResults: null,
  tags: [],
  error: null
}


const reducer = function(state = initialState, action) {
  switch(action.type) {
    case CLEAR_QUERY_STRING:
      return {
        ...state,
        tags: [],
        queryString: ''
      }
    case QUERY_CIRRUS_SUCCESS:
      return {
        ...state,
        queryResults: action.queryResults
      }
    case QUERY_CIRRUS_FAILURE:
      return {
        ...state,
        error: action.error
      }
    default:
      return state;
  }
}

export default reducer;
