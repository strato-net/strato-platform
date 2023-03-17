// TODO: remove searchable and add scenarios of solidvm
import React from 'react';
import CreateContract, { mapStateToProps, validate } from '../../components/CreateContract';
import { Provider } from 'react-redux';
import { Dialog } from '@blueprintjs/core';
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import { payload, source } from './createContractMock'
import { indexAccountsMock } from '../Accounts/accountsMock'
import * as checkMode from '../../lib/checkMode';
import { chain } from '../Chains/chainsMock';

describe('CreateContract: index', () => {
  let store

  let files
  const readAsText = jest.fn();

  beforeAll(() => {
    localStorage.clear();
    files = [
      {
        name: 'file1.sol',
        size: 1111,
        type: ''
      }
    ]
    const fileContents = 'file contents';
    const expectedFinalState = { fileContents: fileContents };
    const file = new Blob([fileContents], { type: 'text/plain' });
    const addEventListener = jest.fn((_, evtHandler) => { evtHandler(); });
    const dummyFileReader = { addEventListener, readAsText, result: fileContents };
    window.FileReader = jest.fn(() => dummyFileReader);
  });


  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })

  describe('render component (Oauth mode)', () => {

    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    });

    test('render contracts without values', () => {
      const props = {
        isOpen: true,
        abi: { src: {} },
        createDisabled: false,
        contractName: 'Cloner',
        contractNameFromEditor: 'Greeter',
        contract: payload.fileText,
        accounts: indexAccountsMock,
        sourceFromEditor: payload.fileText,
        textFromEditor: payload.fileText,
        username: 'Supplier1',
        isToasts: false,
        toastsMessage: 'message',
        searchable: false,
        enableCreateContract: true,
        chainLabel: chain,
        chainLabelIds: chain["airline cartel 9"],
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
        contractOpenModal: jest.fn(),
        contractCloseModal: jest.fn(),
        createContract: jest.fn(),
        compileContract: jest.fn(),
        contractFormChange: jest.fn(),
        fetchContracts: jest.fn(),
        fetchAccounts: jest.fn(),
        fetchUserAddresses: jest.fn(),
        usernameChange: jest.fn(),
        contractNameChange: jest.fn(),
        onChangeEditorContractName: jest.fn(),
        touch: jest.fn(),
        reset: jest.fn(),
        pristine: false, submitting: false, valid: false,
        initialValues: {
          username: '',
          address: ''
        },
        toastsError: ''
      }
      const wrapper = shallow(
        <Provider store={store}>
          <CreateContract.WrappedComponent {...props} />
        </Provider>
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('render contracts without source', () => {
      const props = {
        isOpen: true,
        abi: undefined,
        createDisabled: false,
        contractName: 'Cloner',
        contractNameFromEditor: 'Greeter',
        contract: payload.fileText,
        accounts: indexAccountsMock,
        sourceFromEditor: undefined,
        textFromEditor: payload.fileText,
        username: 'Supplier1',
        isToasts: false,
        toastsMessage: 'message',
        searchable: false,
        enableCreateContract: true,
        chainLabel: chain,
        chainLabelIds: chain["airline cartel 9"],
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
        contractOpenModal: jest.fn(),
        contractCloseModal: jest.fn(),
        createContract: jest.fn(),
        compileContract: jest.fn(),
        contractFormChange: jest.fn(),
        fetchContracts: jest.fn(),
        fetchAccounts: jest.fn(),
        fetchUserAddresses: jest.fn(),
        usernameChange: jest.fn(),
        contractNameChange: jest.fn(),
        onChangeEditorContractName: jest.fn(),
        touch: jest.fn(),
        reset: jest.fn(),
        pristine: false, submitting: false, valid: false,
        initialValues: {
          username: 'Admin_1177_49507',
          address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        toastsError: 'unable to call the function'
      }
      const wrapper = shallow(
        <Provider store={store}>
          <CreateContract.WrappedComponent {...props} />
        </Provider>
      );
      expect(wrapper).toMatchSnapshot();
    });
  });

  describe('render component (non Oauth mode)', () => {

    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    });

    test('render contracts without values', () => {
      const props = {
        isOpen: true,
        abi: { src: undefined },
        createDisabled: false,
        contractName: 'Cloner',
        contractNameFromEditor: 'Greeter',
        contract: payload.fileText,
        accounts: indexAccountsMock,
        sourceFromEditor: payload.fileText,
        textFromEditor: payload.fileText,
        username: 'Supplier1',
        isToasts: false,
        toastsMessage: 'message',
        searchable: false,
        enableCreateContract: true,
        chainLabel: chain,
        chainLabelIds: chain["airline cartel 9"],
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
        contractOpenModal: jest.fn(),
        contractCloseModal: jest.fn(),
        createContract: jest.fn(),
        compileContract: jest.fn(),
        contractFormChange: jest.fn(),
        fetchContracts: jest.fn(),
        fetchAccounts: jest.fn(),
        fetchUserAddresses: jest.fn(),
        usernameChange: jest.fn(),
        contractNameChange: jest.fn(),
        onChangeEditorContractName: jest.fn(),
        touch: jest.fn(),
        reset: jest.fn(),
        pristine: false, submitting: false, valid: false,
        initialValues: {
          username: '',
          address: ''
        }
      }
      const wrapper = shallow(
        <Provider store={store}>
          <CreateContract.WrappedComponent {...props} />
        </Provider>
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('render contracts without source', () => {
      const props = {
        isOpen: true,
        abi: undefined,
        createDisabled: false,
        contractName: 'Cloner',
        contractNameFromEditor: 'Greeter',
        contract: payload.fileText,
        accounts: indexAccountsMock,
        sourceFromEditor: undefined,
        textFromEditor: payload.fileText,
        username: 'Supplier1',
        isToasts: false,
        toastsMessage: 'message',
        searchable: false,
        enableCreateContract: true,
        chainLabel: chain,
        chainLabelIds: chain["airline cartel 9"],
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
        contractOpenModal: jest.fn(),
        contractCloseModal: jest.fn(),
        createContract: jest.fn(),
        compileContract: jest.fn(),
        contractFormChange: jest.fn(),
        fetchContracts: jest.fn(),
        fetchAccounts: jest.fn(),
        fetchUserAddresses: jest.fn(),
        usernameChange: jest.fn(),
        contractNameChange: jest.fn(),
        onChangeEditorContractName: jest.fn(),
        touch: jest.fn(),
        reset: jest.fn(),
        pristine: false, submitting: false, valid: false,
        initialValues: {
          username: 'Admin_1177_49507',
          address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        }
      }
      const wrapper = shallow(
        <Provider store={store}>
          <CreateContract.WrappedComponent {...props} />
        </Provider>
      );
      expect(wrapper).toMatchSnapshot();
    });
  });

  test('open modal', () => {
    const props = {
      isOpen: true,
      abi: { src: {} },
      createDisabled: false,
      contractName: 'Cloner',
      contractNameFromEditor: 'Greeter',
      contract: payload.fileText,
      accounts: indexAccountsMock,
      sourceFromEditor: payload.fileText,
      textFromEditor: payload.fileText,
      username: 'Supplier1',
      isToasts: false,
      toastsMessage: 'message',
      searchable: false,
      enableCreateContract: true,
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      contractOpenModal: jest.fn(),
      contractCloseModal: jest.fn(),
      createContract: jest.fn(),
      compileContract: jest.fn(),
      contractFormChange: jest.fn(),
      fetchContracts: jest.fn(),
      fetchAccounts: jest.fn(),
      fetchUserAddresses: jest.fn(),
      usernameChange: jest.fn(),
      contractNameChange: jest.fn(),
      onChangeEditorContractName: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      pristine: false, submitting: false, valid: false,
      initialValues: {
        username: 'Admin_1177_49507',
        address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      },
      userCertificate: { userAddress: "456789"}
    }
    const wrapper = mount(
      <Provider store={store}>
        <CreateContract.WrappedComponent {...props} />
      </Provider>
    );
    wrapper.find('AnchorButton').simulate('click');
    expect(props.contractOpenModal).toHaveBeenCalled();
  });

  test('close modal on outside click', () => {
    const props = {
      isOpen: true,
      abi: { src: {} },
      createDisabled: false,
      contractName: 'Cloner',
      contractNameFromEditor: 'Greeter',
      contract: payload.fileText,
      accounts: indexAccountsMock,
      sourceFromEditor: payload.fileText,
      textFromEditor: payload.fileText,
      username: 'Supplier1',
      isToasts: false,
      toastsMessage: 'message',
      searchable: false,
      enableCreateContract: true,
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      contractOpenModal: jest.fn(),
      contractCloseModal: jest.fn(),
      createContract: jest.fn(),
      compileContract: jest.fn(),
      contractFormChange: jest.fn(),
      fetchContracts: jest.fn(),
      fetchAccounts: jest.fn(),
      fetchUserAddresses: jest.fn(),
      usernameChange: jest.fn(),
      contractNameChange: jest.fn(),
      onChangeEditorContractName: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      pristine: false, submitting: false, valid: false,
      store: store,
      initialValues: {
        username: 'Admin_1177_49507',
        address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      },
      userCertificate: { userAddress: "456789"}

    }
    const wrapper = mount(
      <Provider store={store}>
        <CreateContract.WrappedComponent {...props} />
      </Provider>
    );
    wrapper.find(Dialog).get(0).props.onClose();
    expect(props.contractCloseModal).toHaveBeenCalled();
  });

  test('close modal on button click', () => {
    const props = {
      isOpen: true,
      abi: { src: {} },
      createDisabled: false,
      contractName: 'Cloner',
      contractNameFromEditor: 'Greeter',
      contract: payload.fileText,
      accounts: indexAccountsMock,
      sourceFromEditor: payload.fileText,
      textFromEditor: payload.fileText,
      username: 'Supplier1',
      isToasts: false,
      toastsMessage: 'message',
      searchable: false,
      enableCreateContract: true,
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      contractOpenModal: jest.fn(),
      contractCloseModal: jest.fn(),
      createContract: jest.fn(),
      compileContract: jest.fn(),
      contractFormChange: jest.fn(),
      fetchContracts: jest.fn(),
      fetchAccounts: jest.fn(),
      fetchUserAddresses: jest.fn(),
      usernameChange: jest.fn(),
      contractNameChange: jest.fn(),
      onChangeEditorContractName: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      pristine: false, submitting: false, valid: false,
      store: store,
      initialValues: {
        username: 'Admin_1177_49507',
        address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      },
      userCertificate: { userAddress: "456789"}

    }
    const wrapper = shallow(
      <CreateContract.WrappedComponent {...props} />
    ).dive().dive().dive();
    wrapper.find('Button').at(0).simulate('click')
    expect(props.contractCloseModal).toHaveBeenCalled();
  });

  test('submit form', () => {
    const props = {
      isOpen: true,
      abi: { src: {} },
      createDisabled: false,
      contractName: 'GreeterC',
      contractNameFromEditor: 'GreeterC',
      contract: source,
      accounts: indexAccountsMock,
      sourceFromEditor: source,
      textFromEditor: payload.fileText,
      username: 'Supplier1',
      isToasts: false,
      toastsMessage: 'message',
      searchable: false,
      enableCreateContract: true,
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      contractOpenModal: jest.fn(),
      contractCloseModal: jest.fn(),
      createContract: jest.fn(),
      compileContract: jest.fn(),
      contractFormChange: jest.fn(),
      fetchContracts: jest.fn(),
      fetchAccounts: jest.fn(),
      fetchUserAddresses: jest.fn(),
      usernameChange: jest.fn(),
      contractNameChange: jest.fn(),
      onChangeEditorContractName: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      pristine: false, submitting: false, valid: false,
      store: store,
      handleSubmit: jest.fn(),
      initialValues: {
        username: 'Admin_1177_49507',
        address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      },
      resetError: jest.fn()
    }
    const wrapper = shallow(
      <CreateContract.WrappedComponent {...props} />
    ).dive().dive().dive();
    wrapper.instance().submit(payload)
    expect(props.createContract).toHaveBeenCalled()

    const solFiles = [
      {
        name: 'file1.sol',
        size: 1111,
        type: ''
      }
    ]
    wrapper.instance().isValidFileType(solFiles)
    wrapper.instance().isValidFileType([])

    const txtFiles = [
      {
        name: 'file1.txt',
        size: 1111,
        type: ''
      }
    ]
    wrapper.instance().isValidFileType(txtFiles)

    wrapper.instance().componentWillReceiveProps({ isToasts: true })

  });

  // TODO: chnaged the scenario need to be updated fully or can be removed (skipping for now)
  test.skip('simulate events', () => {
    const props = {
      isOpen: true,
      abi: { src: {} },
      createDisabled: false,
      contractName: 'GreeterC',
      contractNameFromEditor: 'GreeterC',
      contract: source,
      accounts: indexAccountsMock,
      sourceFromEditor: undefined,
      textFromEditor: payload.fileText,
      username: 'Supplier1',
      isToasts: false,
      toastsMessage: 'message',
      solidvm: false,
      enableCreateContract: true,
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      contractOpenModal: jest.fn(),
      contractCloseModal: jest.fn(),
      createContract: jest.fn(),
      compileContract: jest.fn(),
      contractFormChange: jest.fn(),
      fetchContracts: jest.fn(),
      fetchAccounts: jest.fn(),
      fetchUserAddresses: jest.fn(),
      usernameChange: jest.fn(),
      contractNameChange: jest.fn(),
      onChangeEditorContractName: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      pristine: false, submitting: false, valid: false,
      store: store,
      handleSubmit: jest.fn(),
      initialValues: {
        username: 'Admin_1177_49507',
        address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      }
    }

    const wrapper = shallow(
      <CreateContract.WrappedComponent {...props} />
    ).dive().dive().dive().find(Dialog).dive();

    const fields = wrapper.find('Field')

    fields.at(0).simulate('change', { target: { value: 'airline cartel 9' } })
    expect(props.getLabelIds).toHaveBeenCalled()

    fields.at(2).simulate('change', { target: { value: 'Supplier2' } })
    expect(props.usernameChange).toHaveBeenCalled()

    fields.at(5).simulate('change', { target: { checked: true } })
    expect(props.compileContract).toHaveBeenCalled()

    fields.at(7).simulate('change', { target: { value: 'Supplier2' } })
    expect(props.contractNameChange).toHaveBeenCalled()

    wrapper.find('Button').at(1).simulate('click')
    expect(props.handleSubmit).toHaveBeenCalled()

  });

  test('mapStateToProps with default states', () => {
    const state = {
      createContract: {
        isOpen: true,
        abi: { src: {} },
        createDisabled: false,
        contractName: 'Cloner',
        contract: '',
        username: '',
        isToasts: false,
        toastsMessage: 'message',
        toastsError: ''
      },
      accounts: {
        accounts: indexAccountsMock
      },
      user: {
        oauthUser: {
          id: 6,
          username: "tanuj41",
          address: "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
        },
      },
      chains: {
        chainIds: [],
        listChain: chain,
        listLabelIds: chain["airline cartel 9"]
      },
      codeEditor : {
        codeType : "SolidVM"
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

  describe('validate', () => {

    test('with values', () => {
      const values = {
        address: "ff1046b63167dbf7fcf2f0deccd2ea6c2972c78e",
        contract: [
          {
            name: 'file1.sol',
            size: 1111,
            type: ''
          }
        ],
        password: "1234",
        username: "abc",
        _greeting: "fdas",

      }
      expect(validate(values)).toMatchSnapshot();
    });

    test('with empty values', () => {
      const values = {
        address: undefined,
        contract: undefined,
        password: undefined,
        username: undefined,
        _greeting: undefined,
      }
      expect(validate(values)).toMatchSnapshot();
    });

  })

});