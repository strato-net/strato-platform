import {
    SEARCH_QUERY_SUCCESS,
    SEARCH_QUERY_REQUEST,
    SEARCH_QUERY_FAILURE,
  } from './searchresults.actions';
  
const initialState = {
    searchQuery: '',
    searchResults: undefined,
    searchError: undefined,
  };

  const reducer = function (state = initialState, action) {
    switch (action.type) {
      case SEARCH_QUERY_REQUEST:
        const searchQuery = action.searchQuery;
        return {
          ...state,
          searchQuery: searchQuery,
        };
    case SEARCH_QUERY_SUCCESS:
        const searchResults = action.searchResults;
        return {
          ...state,
          searchResults: searchResults,
        };
    case SEARCH_QUERY_FAILURE:
        const error = action.error;
        return {
          ...state,
          searchError: error,
        };
      default:
        return state;
    }
  };
  
  export default reducer;
