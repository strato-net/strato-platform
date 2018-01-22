import {
  FETCH_APPS_FAILURE,
  FETCH_APPS_SUCCESSFUL
} from './apps.actions';

const initialState = {
  apps: [],
  error: null
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_APPS_SUCCESSFUL:
      const applications = action
        .applications
        .map((a) => {
          return {
            ...a,
            isLoading: false,
            url: `/apps/${a.hash}/`
          };
        });
      return {
        apps: applications,
        error: null,
      };

    case FETCH_APPS_FAILURE:
      return {
        apps: [],
        error: action.error,
      };
    default:
      return state;

  }
};

export default reducer;
