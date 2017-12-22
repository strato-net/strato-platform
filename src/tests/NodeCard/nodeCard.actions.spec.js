import {
  preloadPeers,
  updatePeers,
  preloadCoinbase,
  updateCoinbase
} from '../../components/NodeCard/nodeCard.actions';
import { node, nodeWithPeers } from '../Dashboard/dashboardMock';


describe('Test nodeCard actions', () => {

  test('should load peers', () => {
    expect(preloadPeers(node.peers)).toMatchSnapshot();
  });

  test('should update peers', () => {
    expect(updatePeers(nodeWithPeers.peers)).toMatchSnapshot();
  });

  test('should load coinbase', () => {
    expect(preloadCoinbase(node.coinbase)).toMatchSnapshot();
  });

  test('should update coinbase', () => {
    let coinbase = { coinbase: null }
    expect(updateCoinbase(coinbase)).toMatchSnapshot();
  });

});