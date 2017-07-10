export const QUERY_TYPE_FIELD_CHANGE = "QUERY_TYPE_FIELD_CHANGE";
export const QUERY_VALUE_FIELD_CHANGE = "QUERY_VALUE_FIELD_CHANGE";

export const queryTypeFieldChange = function(queryType) {
  return {
    type: QUERY_TYPE_FIELD_CHANGE,
    queryType: queryType
  }
};

export const queryValueFieldChange = function(queryValue) {
  return {
    type: QUERY_VALUE_FIELD_CHANGE,
    queryValue: queryValue
  }
};
