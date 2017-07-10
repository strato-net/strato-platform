import {
  QUERY_VALUE_FIELD_CHANGE,
  QUERY_TYPE_FIELD_CHANGE
} from './transactionTable.actions';

const initialState = {
  queryType: undefined,
  queryValue: undefined,
};


const reducer = function (state = initialState, action) {
  switch (action.type) {
    case QUERY_TYPE_FIELD_CHANGE:
      return {
        queryType: action.queryType,
        queryValue: state.queryValue
      };
    case QUERY_VALUE_FIELD_CHANGE:
      return {
        queryType: state.queryType,
        queryValue: action.queryValue
      };
    default:
      return state;
  }
};

export default reducer;
