import {
  PRELOAD_BLOCK_NUMBER,
  UPDATE_BLOCK_NUMBER,
  PRELOAD_CONTRACT_COUNT,
  UPDATE_CONTRACT_COUNT,
  PRELOAD_USERS_COUNT,
  UPDATE_USERS_COUNT
} from './dashboard.action'

const initialState = {
  lastBlockNumber: 0,
  usersCount: 0,
  contractsCount: 0
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case PRELOAD_BLOCK_NUMBER:
      return {
        ...state,
        lastBlockNumber: action.data
      };

    case UPDATE_BLOCK_NUMBER:
      return {
        ...state,
        lastBlockNumber: action.data
      };

    case PRELOAD_CONTRACT_COUNT:
      return {
        ...state,
        contractsCount: action.data
      }

    case UPDATE_CONTRACT_COUNT:
      return {
        ...state,
        contractsCount: action.data
      };

    case PRELOAD_USERS_COUNT:
      return {
        ...state,
        usersCount: action.data
      };

    case UPDATE_USERS_COUNT:
      return {
        ...state,
        usersCount: action.data
      };

    default:
      return state;
  }
};

export default reducer;