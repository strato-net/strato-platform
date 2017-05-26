import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY
} from './createContract.actions';

const initialState = {
  isOpen: false,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_OVERLAY:
      return {
        isOpen: true,
      };
    case CLOSE_OVERLAY:
      return {
        isOpen: false
      };
    default:
      return state;
  }
};

export default reducer;