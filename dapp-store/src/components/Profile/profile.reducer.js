import {
  FETCH_ACCOUNT_DETAIL_SUCCESS,
  FETCH_ACCOUNT_DETAIL_FAILURE
} from './profile.action';

const initialState = {
  account: {},
  error: null
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_ACCOUNT_DETAIL_SUCCESS:
      return {
        account: action.detail,
        error: state.error
      }

    case FETCH_ACCOUNT_DETAIL_FAILURE:
      return {
        account: {},
        error: action.error
      }
    default:
      return state;
  }
};

export default reducer;
