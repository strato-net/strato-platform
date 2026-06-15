import React from 'react';
import Chains, { mapStateToProps } from '../../components/Chains';
import { chain } from './chainsMock';

describe('Chains: index', () => {

  describe('render component', () => {

    test('with empty values', () => {
      const props = {
        labelIds: [],
        chains: [],
        filter: null,
        isLoading: false,
        changeChainFilter: jest.fn(),
        resetChainId: jest.fn(),
        fetchChains: jest.fn(),
        fetchChainDetail: jest.fn()
      };

      const wrapper = shallow(
        <Chains.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
      expect(props.fetchChains).toHaveBeenCalled();
      expect(props.fetchChains).toHaveBeenCalledTimes(1);
    });

    test('with values', () => {
      const props = {
        labelIds: chain,
        chains: chain,
        filter: null,
        isLoading: true,
        changeChainFilter: jest.fn(),
        resetChainId: jest.fn(),
        fetchChains: jest.fn(),
        fetchChainDetail: jest.fn()
      };

      const wrapper = shallow(
        <Chains.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
      expect(props.fetchChains).toHaveBeenCalled();
      expect(props.fetchChains).toHaveBeenCalledTimes(1);
    });

  });

  test('filter chain', () => {
    const props = {
      labelIds: chain,
      chains: chain,
      filter: null,
      isLoading: false,
      changeChainFilter: jest.fn(),
      resetChainId: jest.fn(),
      fetchChains: jest.fn(),
      fetchChainDetail: jest.fn()
    };

    const wrapper = shallow(
      <Chains.WrappedComponent {...props} />
    );

    wrapper.find('input').simulate('change', { target: { value: 'airline cartel 1' } });
    expect(props.changeChainFilter).toHaveBeenCalled();
    expect(props.changeChainFilter).toHaveBeenCalledTimes(1);
  });

  test('show/hide chain detail', () => {
    const props = {
      labelIds: chain,
      chains: chain,
      filter: null,
      isLoading: false,
      changeChainFilter: jest.fn(),
      resetChainId: jest.fn(),
      fetchChains: jest.fn(),
      fetchChainDetail: jest.fn()
    };

    const wrapper = shallow(
      <Chains.WrappedComponent {...props} />
    );

    wrapper.find('div').at(19).simulate('click');
    expect(props.fetchChainDetail).toHaveBeenCalled();
    expect(props.fetchChainDetail).toHaveBeenCalledTimes(1);
    wrapper.find('div').at(19).simulate('click');
    expect(props.resetChainId).toHaveBeenCalled();
    expect(props.resetChainId).toHaveBeenCalledTimes(1);
  });

  test('filter chain', () => {
    const props = {
      labelIds: chain,
      chains: chain,
      filter: 'airline cartel',
      isLoading: false,
      changeChainFilter: jest.fn(),
      resetChainId: jest.fn(),
      fetchChains: jest.fn(),
      fetchChainDetail: jest.fn()
    };

    const wrapper = shallow(
      <Chains.WrappedComponent {...props} />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('mapStateToProps with default state', () => {
    const state = {
      chains: {
        filter: 'airline',
        chains: chain,
        labelIds: chain,
        initialLabel: null
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});