import {
    SEARCH_QUERY_SUCCESS,
    SEARCH_QUERY_REQUEST,
  } from './searchresults.actions';
  
const initialState = {
    searchQuery: '',
    searchResult: undefined,
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
        const searchResult = action.searchResult;
        return {
          ...state,
          searchResult: searchResult,
        };
      default:
        return state;
    }
  };
  
  export default reducer;
