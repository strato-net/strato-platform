import React from 'react';
import PeersCard, { mapStateToProps } from '../../components/PeersCard';
import { nodeWithPeers } from '../Dashboard/dashboardMock';

describe('PeersCard: index', () => {

  describe('render component', () => {
    test('without values', () => {
      const props = {
        node: {}
      };

      const wrapper = shallow(
        <PeersCard.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        node: nodeWithPeers
      };

      const wrapper = shallow(
        <PeersCard.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });
  });

  test('mapStateToProps', () => {
    const state = {
      node: nodeWithPeers
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});