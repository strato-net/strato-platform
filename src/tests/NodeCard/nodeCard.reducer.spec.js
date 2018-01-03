import reducer from '../../components/NodeCard/nodeCard.reducer';
import { preloadPeers, updatePeers, preloadCoinbase, updateCoinbase } from '../../components/NodeCard/nodeCard.actions';
import { node, nodeWithPeers } from '../Dashboard/dashboardMock';
import { nodeCardInitialState } from './nodeCardMock';

describe('NodeCard: reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('PEERS', () => {
    // PRELOAD_PEERS
    test('store', () => {
      const action = preloadPeers(node.peers);
      expect(reducer(nodeCardInitialState, action)).toMatchSnapshot();
    });

    // PRELOAD_PEERS
    test('update', () => {
      const action = updatePeers(nodeWithPeers.peers);
      expect(reducer(nodeCardInitialState, action)).toMatchSnapshot();
    });
  });

  describe('COINBASE', () => {
    // PRELOAD_COINBASE
    test('store', () => {
      const action = preloadCoinbase(node.coinbase);
      expect(reducer(nodeCardInitialState, action)).toMatchSnapshot();
    });

    // PRELOAD_COINBASE
    test('update', () => {
      const action = updateCoinbase({ coinbase: null });
      expect(reducer(nodeCardInitialState, action)).toMatchSnapshot();
    });
  });

});