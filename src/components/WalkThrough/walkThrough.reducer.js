import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY
} from './walkThrough.actions';

const initialState = {
  isWalkThroughOpen: false,
  isLoggedIn: false
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_OVERLAY:
      return {
        isWalkThroughOpen: true,
        isLoggedIn: action.isLoggedIn
      };
    case CLOSE_OVERLAY:
      return {
        isWalkThroughOpen: false,
        isLoggedIn: state.isLoggedIn
      };
    default:
      return state;
  }
};

export default reducer;