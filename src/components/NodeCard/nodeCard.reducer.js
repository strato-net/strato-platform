import {
  FETCH_NODE_DETAIL_SUCCESS,
  FETCH_NODE_PEERS_SUCCESS,
  FETCH_NODE_PEERS_FAILURE,
  FETCH_NODE_COINBASE_SUCCESS,
} from './nodeCard.actions';
import { env } from '../../env';

const initialState = {
  nodes: [{
    name: env.NODE_NAME
  }]
};

const reducer = function (state = initialState, action) {
  switch(action.type) {
    case FETCH_NODE_DETAIL_SUCCESS:
      return {
        nodes: state.nodes.map((node,index) => {
          if(index !== action.nodeIndex) {
            return node;
          }

          return {
            ...state.nodes[action.nodeIndex],
            detail: action.detail
          }
        })
      }
    case FETCH_NODE_PEERS_SUCCESS:
      return {
        nodes: state.nodes.map((node,index) => {
          if(index !== action.nodeIndex) {
            return node;
          }

          return {
            ...state.nodes[action.nodeIndex],
            peers: action.peers,
            apiFailure: false
          }
        })
      }
    case FETCH_NODE_PEERS_FAILURE:
      return {
        nodes: state.nodes.map((node,index) => {
          if(index !== action.nodeIndex) {
            return node;
          }

          return {
            ...state.nodes[action.nodeIndex],
            apiFailure: true
          }
        })
      }
    case FETCH_NODE_COINBASE_SUCCESS:
      return {
        nodes: state.nodes.map((node,index) => {
          if(index !== action.nodeIndex) {
            return node;
          }

          return {
            ...state.nodes[action.nodeIndex],
            coinbase: action.coinbase
          }
        })
      }
    default:
      return state;
  }
}

export default reducer;
