import {
  preloadPeers,
  updatePeers,
  preloadCoinbase,
  updateCoinbase
} from '../../components/NodeCard/nodeCard.actions';
import { node, nodeWithPeers } from '../Dashboard/dashboardMock';

describe('NodeCard: actions', () => {

  describe('peers', () => {

    test('load', () => {
      expect(preloadPeers(node.peers)).toMatchSnapshot();
    });

    test('update', () => {
      expect(updatePeers(nodeWithPeers.peers)).toMatchSnapshot();
    });

  });

  describe('coinbase ', () => {

    test('load', () => {
      expect(preloadCoinbase(node.coinbase)).toMatchSnapshot();
    });

    test('update', () => {
      let coinbase = { coinbase: null }
      expect(updateCoinbase(coinbase)).toMatchSnapshot();
    });

  });

});