import {
  preloadPeers,
  updatePeers,
  preloadCoinbase,
  updateCoinbase
} from '../../components/NodeCard/nodeCard.actions';
import { node, nodeWithPeers } from '../Dashboard/dashboardMock';


describe('Test nodeCard actions', () => {

  it('should load peers', () => {
    expect(preloadPeers(node.peers)).toMatchSnapshot();
  });

  it('should update peers', () => {
    expect(updatePeers(nodeWithPeers.peers)).toMatchSnapshot();
  });

  it('should load coinbase', () => {
    expect(preloadCoinbase(node.coinbase)).toMatchSnapshot();
  });

  it('should update coinbase', () => {
    let coinbase = { coinbase: null }
    expect(updateCoinbase(coinbase)).toMatchSnapshot();
  });

});