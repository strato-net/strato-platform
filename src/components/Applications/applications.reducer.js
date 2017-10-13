import {
  FETCH_APPLICATIONS_SUCCESSFUL,
  FETCH_APPLICATIONS_FAILURE
} from './applications.actions';

const initialState = {
  applcations: [],
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_APPLICATIONS_SUCCESSFUL:
      return {
        applications: action.applications,
        error: null,
      };
    case FETCH_APPLICATIONS_FAILURE:
      return {
        applications: [],
        error: action.error,
      };
    default:
      return state;
  
  }
};

export default reducer;
