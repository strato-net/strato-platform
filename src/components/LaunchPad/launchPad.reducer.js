import {
  APP_USERNAME_CHANGE,
  LAUNCHPAD_LOAD,
} from './launchPad.actions';

const initialState = {
  firstLoad: true,
  username: '',
}

const reducer = function(state=initialState, action) {
  switch(action.type) {
    case LAUNCHPAD_LOAD:
      return {
        ...state,
        firstLoad: false
      }
    case APP_USERNAME_CHANGE:
      return {
        ...state,
        username: action.name
      };
    default:
      return state;
  }
}

export default reducer;
