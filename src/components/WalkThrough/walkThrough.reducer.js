import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY
} from './walkThrough.actions';

const initialState = {
  isWalkThroughOpen: false,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_OVERLAY:
      return {
        isWalkThroughOpen: true,
      };
    case CLOSE_OVERLAY:
      return {
        isWalkThroughOpen: false
      };
    default:
      return state;
  }
};

export default reducer;