export const ADD_QUERY = 'ADD_QUERY';

export const addQuery = function (queryType, queryTerm) {
  return {
    type: ADD_QUERY,
    queryType: queryType,
    queryTerm: queryTerm
  }
};