import React from 'react';
import ContractCard, { mapStateToProps } from '../../../../components/Contracts/components/ContractCard/index';

describe('ContractCard: index', () => {

  describe('render contract with', () => {

    test('empty values', () => {
      const props = {
        contract: '',
        fetchCirrusInstances: jest.fn(),
        fetchAccount: jest.fn(),
        fetchState: jest.fn(),
        selectContractInstance: jest.fn()
      }
      let wrapper = shallow(
        <ContractCard.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('mocked values', () => {
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
        fetchCirrusInstances: jest.fn(),
        fetchAccount: jest.fn(),
        fetchState: jest.fn(),
        selectContractInstance: jest.fn(),
        fetchContractInfoRequest: jest.fn(),
      }
      let wrapper = shallow(
        <ContractCard.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

  })

  describe('render ContractCard', () => {

    test('attribute fromBlock and fromCirrus have false value', () => {
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
        fetchCirrusInstances: jest.fn(),
        fetchAccount: jest.fn(),
        fetchState: jest.fn(),
        selectContractInstance: jest.fn(),
        fetchContractInfoRequest: jest.fn(),
      }
      let wrapper = shallow(
        <ContractCard.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('instance selection', () => {
      const props = {
        contract: {
          name: 'Greeter', 
          contract: {
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
        selectedChain: '1c8792a7e43d132487500936d946f510e7ff51635838060757bf886828403a14',
        fetchCirrusInstances: jest.fn(),
        fetchAccount: jest.fn(),
        fetchState: jest.fn(),
        selectContractInstance: jest.fn(),
        fetchContractInfoRequest: jest.fn(),
      }
      let wrapper = shallow(
        <ContractCard.WrappedComponent {...props} />
      );
      wrapper.find('tr').at(1).simulate('click');
      expect(props.fetchAccount).toHaveBeenCalled();
      expect(props.fetchState).toHaveBeenCalled();
      expect(props.selectContractInstance).toHaveBeenCalled();
      expect(props.fetchContractInfoRequest).toHaveBeenCalled();
      expect(wrapper).toMatchSnapshot();
    });

  })

  test('component methods', () => {
    const props = {
      contract: '',
      fetchCirrusInstances: jest.fn().mockReturnValue('fetchCirrusInstances'),
      fetchAccount: jest.fn().mockReturnValue('fetchAccount'),
      fetchState: jest.fn().mockReturnValue('fetchState'),
      selectContractInstance: jest.fn().mockReturnValue('selectContractInstance'),
      fetchContractInfoRequest: jest.fn().mockReturnValue('fetchContractInfoRequest'),
    }
    const wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );
    expect(wrapper.instance().props.fetchCirrusInstances()).toBe('fetchCirrusInstances');
    expect(wrapper.instance().props.fetchAccount()).toBe('fetchAccount');
    expect(wrapper.instance().props.fetchState()).toBe('fetchState');
    expect(wrapper.instance().props.selectContractInstance()).toBe('selectContractInstance');
    expect(wrapper.instance().props.fetchContractInfoRequest()).toBe('fetchContractInfoRequest');
  });

  test('mapStateToProps with default values', () => {
    expect(mapStateToProps({
      chains: {
        selectedChain: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
      },
      contractCard: {
        contractInfos: {}
      }
    })).toMatchSnapshot();
  });

  test('simulate show contracts click', () => {
    const props = {
      contract: '',
      fetchCirrusInstances: jest.fn().mockReturnValue('fetchCirrusInstances'),
      fetchAccount: jest.fn().mockReturnValue('fetchAccount'),
      fetchState: jest.fn().mockReturnValue('fetchState'),
      selectContractInstance: jest.fn().mockReturnValue('selectContractInstance'),
      fetchContractInfoRequest: jest.fn().mockReturnValue('fetchContractInfoRequest'),
    }
    const wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );
    wrapper.find('Button').at(1).simulate('click');
    expect(wrapper.instance().state.isOpen).toBe(true);
  });

});
