import {
  CLEAR_QUERY_STRING,
  QUERY_CIRRUS_SUCCESS,
  QUERY_CIRRUS_FAILURE,
  QUERY_CIRRUS_VARS_SUCCESS,
  ADD_QUERY_FILTER
} from './contractQuery.actions';

const initialState = {
  queryString: '',
  queryResults: null,
  tags: [],
  vars: null,
  error: null
}

function getTag(tag) {
  const displayValue = tag.field + ' ' + tag.operator + ' ' + tag.value;
  return {
    ...tag,
    display: displayValue
  }
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
    case QUERY_CIRRUS_VARS_SUCCESS:
      return {
        ...state,
        vars: action.vars
      }
    case ADD_QUERY_FILTER:
      const tags = state.tags;
      tags.push(getTag({
          field: action.field,
          operator: action.operator,
          value: action.value
        })
      );
      return {
        ...state,
        tags: tags,
        queryString: tags.reduce((queryString,tag) => {
          let qs = queryString;
          if(qs !== '')
            qs += '&';
          qs += tag.field + '=' + tag.operator + '.' + tag.value;
          return qs;
        },'')
      }
    default:
      return state;
  }
}

export default reducer;
