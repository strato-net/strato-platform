import React from 'react';
import Contracts from '../../components/Contracts/index';
import ReactTestUtils from 'react-dom/test-utils';
import renderer from "react-test-renderer";
import { contracts } from './contractsMock';

describe('Test contracts index', () => {

  test('should contracts render with empty values', () => {
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

  test('should contracts renders correctly', () => {
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

  test('should test functions', () => {
    const props = {
      filter: '',
      contracts: {},
      fetchContracts: jest.fn(() => Promise.resolve(0)),
      changeContractFilter: jest.fn(() => Promise.resolve(0))
    }

    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );

    expect(props.fetchContracts).toHaveBeenCalled();
    expect(props.changeContractFilter).toHaveBeenCalled();
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

})