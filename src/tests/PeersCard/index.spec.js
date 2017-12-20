import React from 'react';
import PeersCard, { mapStateToProps } from '../../components/PeersCard';
import { nodeWithPeers } from '../Dashboard/dashboardMock';

describe('Test PeerCard index', () => {

  it('should render with empty values', () => {
    const props = {
      node: {}
    };

    const wrapper = shallow(
      <PeersCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  it('should render with mocked values', () => {
    const props = {
      node: nodeWithPeers
    };

    const wrapper = shallow(
      <PeersCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  it('test mapStateToProps function', () => {
    const state = {
      node: nodeWithPeers
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});