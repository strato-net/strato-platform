import React from 'react';
import Contracts, { mapStateToProps } from '../../components/Contracts/index';
import { contracts } from './contractsMock';

describe('Test contracts index', () => {

  test('should render contracts with empty values', () => {
    const props = {
      filter: '',
      contracts: {},
      fetchContracts: jest.fn(() => Promise.resolve(0)),
      changeContractFilter: jest.fn(() => Promise.resolve(0))
    }

    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should render contract with mocked values', () => {
    const props = {
      filter: 'Greeter',
      contracts: contracts,
      fetchContracts: () => { },
      changeContractFilter: () => { }
    }

    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should test component functions', () => {
    const props = {
      filter: '',
      contracts: {},
      fetchContracts: jest.fn().mockReturnValue('fetchContracts'),
      changeContractFilter: jest.fn().mockReturnValue('changeContractFilter')
    }

    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );

    wrapper.instance().updateFilter = jest.fn().mockReturnValue('updateFilter');

    expect(wrapper.instance().updateFilter()).toBe('updateFilter');
    expect(wrapper.instance().props.fetchContracts()).toBe('fetchContracts')
    expect(wrapper.instance().props.changeContractFilter()).toBe('changeContractFilter');
  });

  test('should test filter with value', () => {
    const props = {
      filter: 'Greeter',
      contracts: {},
      fetchContracts: () => { },
      changeContractFilter: () => { }
    }

    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should test contracts with values', () => {
    const props = {
      filter: '',
      contracts: contracts,
      fetchContracts: () => { },
      changeContractFilter: () => { }
    }

    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('test mapStateToProps function', () => {
    const state = {
      contracts: {
        contracts: contracts,
        filter: 'Time'
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})