import {
  PRELOAD_PEERS,
  UPDATE_PEERS,
  PRELOAD_COINBASE,
  UPDATE_COINBASE
} from './nodeCard.actions';
import { env } from '../../env';

const initialState = {
  name: env.NODE_NAME,
  peers: {},
  coinbase: ''
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case PRELOAD_PEERS:
      return {
        ...state,
        peers: action.peers
      }
    case UPDATE_PEERS:
      return {
        ...state,
        peers: action.peers
      }
    case PRELOAD_COINBASE:
      return {
        ...state,
        coinbase: action.coinbase
      }
    case UPDATE_COINBASE:
      return {
        ...state,
        coinbase: action.coinbase
      }
    default:
      return state;
  }
}

export default reducer;
