import React from 'react';
import Contracts, { mapStateToProps } from '../../components/Contracts/index';
import { contracts } from './contractsMock';

describe('Contracts: index', () => {

  describe('render contracts with', () => {

    test('empty values', () => {
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

    test('mocked values', () => {
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

  })

  test('component methods', () => {
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

  test('filter with value', () => {
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

  test('contracts with values', () => {
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

  test('search contract input', () => {
    const props = {
      filter: 'Greeter',
      contracts: {},
      fetchContracts: jest.fn(),
      changeContractFilter: jest.fn()
    }
    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );

    wrapper.find('input').simulate('change', { target: { value: "UPDATE" } });
    expect(props.changeContractFilter).toHaveBeenCalled();
    expect(props.changeContractFilter.mock.calls.length).toBe(2);
    expect(props.changeContractFilter.mock.calls).toMatchSnapshot();
  });

  test('mapStateToProps with default values', () => {
    const state = {
      contracts: {
        contracts: contracts,
        filter: 'Time'
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})