import reducer from '../../components/NodeCard/nodeCard.reducer';
import { preloadPeers, updatePeers, preloadCoinbase, updateCoinbase } from '../../components/NodeCard/nodeCard.actions';
import { node, nodeWithPeers } from '../Dashboard/dashboardMock';
import { nodeCardInitialState } from './nodeCardMock';

describe('Test nodeCard reducer', () => {

  // INITIAL_STATE
  it('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // PRELOAD_PEERS
  it('should store peers', () => {
    const action = preloadPeers(node.peers);
    expect(reducer(nodeCardInitialState, action)).toMatchSnapshot();
  });

  // PRELOAD_PEERS
  it('should update peers', () => {
    const action = updatePeers(nodeWithPeers.peers);
    expect(reducer(nodeCardInitialState, action)).toMatchSnapshot();
  });

  // PRELOAD_COINBASE
  it('should store coinbase', () => {
    const action = preloadCoinbase(node.coinbase);
    expect(reducer(nodeCardInitialState, action)).toMatchSnapshot();
  });

  // PRELOAD_COINBASE
  it('should update coinbase', () => {
    const action = updateCoinbase({ coinbase: null });
    expect(reducer(nodeCardInitialState, action)).toMatchSnapshot();
  });

});