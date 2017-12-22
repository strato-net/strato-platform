import React from 'react';
import PeersCard, { mapStateToProps } from '../../components/PeersCard';
import { nodeWithPeers } from '../Dashboard/dashboardMock';

describe('Test PeerCard index', () => {

  test('should render with empty values', () => {
    const props = {
      node: {}
    };

    const wrapper = shallow(
      <PeersCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should render with mocked values', () => {
    const props = {
      node: nodeWithPeers
    };

    const wrapper = shallow(
      <PeersCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('test mapStateToProps function', () => {
    const state = {
      node: nodeWithPeers
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});