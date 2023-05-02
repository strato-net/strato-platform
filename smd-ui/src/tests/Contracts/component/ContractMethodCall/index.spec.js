import React from 'react';
import ContractMethodCall, { mapStateToProps, validate } from '../../../../components/Contracts/components/ContractMethodCall/index';
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import { Provider } from 'react-redux';
import { modals } from './contractMethodCallMock';
import { indexAccountsMock } from '../../../Accounts/accountsMock'
import * as checkMode from '../../../../lib/checkMode';
import { chain } from '../../../Chains/chainsMock';

describe('ContractMethodCall: index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })


  test('renders contracts card (Oauth mode)', () => {
    const props = {
      methodCallModal: {
        isPayable: false
      },
      contractInfo: {
        bin: 'contract Foo {}',
        xabi: {
          funcs: {
            'setX': {
              args: {
                a: {
                  type:'int',
                  tag: 'Int'
                }
              }
            },
          }
        },
        address: "f114257cb370ad0e0025eedf0a96261b51af23e3",
      },
      accounts: {},
      modalUsername: 'Buyer1',
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      oAuthUser: {
        "id": '',
        "username": 'Supplier1',
        "address": '370adf114257cb0e0025eedf0a96261b51af23e3'
      },
      symbolName: 'setX',
      contractKey: 'card-data-f114257cb370ad0e0025eedf0a96261b51af23e3-',
      methodKey: 'methodCall-f114257cb370ad0e0025eedf0a96261b51af23e3-',
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
      store: store
    }

    checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);

    const wrapper = shallow(
      <ContractMethodCall.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('mapStateToProps with default values', () => {
    const state = {
      methodCall: {
        methodCallModal: {
          isPayable: false
        },
      },
      symbolName: 'setX',
      contractInfo: {
        bin: 'contract Foo {}',
        xabi: {
          funcs: {
            'setX': {
              args: {
                a: {
                  type:'int',
                  tag: 'Int'
                }
              }
            },
          }
        },
        address: "f114257cb370ad0e0025eedf0a96261b51af23e3",
      },
      contractCard: {
        contractInfos: {}
      },
      contractKey: 'card-data-f114257cb370ad0e0025eedf0a96261b51af23e3-',
      chains: {
        listChain: chain,
        listLabelIds: chain["airline cartel 9"]
      },
      user: {
        "username": null,
        "oAuthUser": {
          "username": "tanuj41",
          "address": "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
        },
        "isLoggedIn": true,
        "error": null,
        "isOpen": false,
        "spinning": false
      },
      accounts: indexAccountsMock
    }
    expect(mapStateToProps(state, 'methodCallgreetf62c8965f2129d178aa28c043f9b3d0cd52f9e2e')).toMatchSnapshot();
  });

  test('simulate submit form', () => {
    const props = {
      methodCallModal: modals,
      contractInfo: {

      },
      contractInfo: {
        bin: 'contract Foo {}',
        xabi: {
          funcs: {
            'setX': {
              args: {
                a: {
                  type:'int',
                  tag: 'Int'
                }
              }
            },
          }
        },
        address: "f114257cb370ad0e0025eedf0a96261b51af23e3",
      },
      symbolName: 'setX',
      contractKey: 'card-data-f114257cb370ad0e0025eedf0a96261b51af23e3-',
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      oAuthUser: {
        "id": 6,
        "username": "tanuj41",
        "address": "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
      },
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
      store: store
    }
    const wrapper = shallow(
      <Provider store={store}>
        <ContractMethodCall.WrappedComponent {...props} />
      </Provider>
    ).dive().dive().dive().dive();
    wrapper.find('button').simulate('click')
    expect(props.methodCall).toHaveBeenCalled();
  });

  test('validate', () => {
    const values = {
      username: '',
      address: null,
      password: null
    }

    expect(validate(values)).toMatchSnapshot();
  });

});


