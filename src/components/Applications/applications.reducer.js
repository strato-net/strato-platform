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
      // only return unique apps
      const applications = action
        .applications
        .map((a) => {
           a.address = undefined;
           a.url = a.url.replace('localhost', 'localhost:3001');
           a.url += '/ui';
           return a;
         })
        .filter((app,i,v) => {
          return v.findIndex((a) => {
            return app.appName === a.appName
            && app.description === a.description
            && app.version === a.version
          }) === i
        });
      return {

        applications: applications,
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
