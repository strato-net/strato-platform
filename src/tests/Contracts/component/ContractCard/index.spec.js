import React from 'react';
import ContractCard, { mapStateToProps } from '../../../../components/Contracts/components/ContractCard/index';

describe('Test ContractCard index', () => {

  test('should render contract with empty values', () => {
    const props = {
      contract: '',
      fetchCirrusInstances: () => { },
      fetchAccount: () => { },
      fetchState: () => { },
      selectContractInstance: () => { }
    }

    let wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );
    expect(wrapper).toMatchSnapshot();
  });

  test('should render contract with mocked values', () => {
    const props = {
      contract: {
        name: 'Greeter', contract: {
          "instances": [
            {
              "createdAt": 1512481078000,
              "address": "0293f9b10a4453667db7fcfe74728c9d821add4b",
              "fromBloc": true,
              "fromCirrus": true
            }
          ]
        }
      },
      fetchCirrusInstances: () => { },
      fetchAccount: () => { },
      fetchState: () => { },
      selectContractInstance: () => { }
    }

    let wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should render ContractCard attribute fromBlock and fromCirrus with false value', () => {
    const props = {
      contract: {
        name: 'Greeter', contract: {
          "instances": [
            {
              "createdAt": 1512481078000,
              "address": "0293f9b10a4453667db7fcfe74728c9d821add4b",
              "fromBloc": false,
              "fromCirrus": false
            }
          ]
        }
      },
      fetchCirrusInstances: () => { },
      fetchAccount: () => { },
      fetchState: () => { },
      selectContractInstance: () => { }
    }

    let wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should render contractCard on instance selection', () => {
    const props = {
      contract: {
        name: 'Greeter', contract: {
          "instances": [
            {
              "createdAt": 1512481078000,
              "address": "0293f9b10a4453667db7fcfe74728c9d821add4b",
              "fromBloc": false,
              "fromCirrus": false,
              "selected": true,
              "balance": 0,
              "state": {
                "greet": "function () returns (String)",
                "greeting": "sadasd"
              }
            }
          ]
        }
      },
      fetchCirrusInstances: () => { },
      fetchAccount: () => { },
      fetchState: () => { },
      selectContractInstance: () => { }
    }

    let wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should test component functions', () => {
    const props = {
      contract: '',
      fetchCirrusInstances: jest.fn().mockReturnValue('fetchCirrusInstances'),
      fetchAccount: jest.fn().mockReturnValue('fetchAccount'),
      fetchState: jest.fn().mockReturnValue('fetchState'),
      selectContractInstance: jest.fn().mockReturnValue('selectContractInstance')
    }

    const wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );

    expect(wrapper.instance().props.fetchCirrusInstances()).toBe('fetchCirrusInstances');
    expect(wrapper.instance().props.fetchAccount()).toBe('fetchAccount');
    expect(wrapper.instance().props.fetchState()).toBe('fetchState');
    expect(wrapper.instance().props.selectContractInstance()).toBe('selectContractInstance');
  });

  test('test mapStateToProps function', () => {
    expect(mapStateToProps({})).toMatchSnapshot();
  });

  test('should display contract on show contracts click', () => {
    const props = {
      contract: '',
      fetchCirrusInstances: jest.fn().mockReturnValue('fetchCirrusInstances'),
      fetchAccount: jest.fn().mockReturnValue('fetchAccount'),
      fetchState: jest.fn().mockReturnValue('fetchState'),
      selectContractInstance: jest.fn().mockReturnValue('selectContractInstance')
    }

    const wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );

    wrapper.find('Button').simulate('click');
    expect(wrapper.instance().state.isOpen).toBe(true);
  });

});
