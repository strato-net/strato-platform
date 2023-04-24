import React from 'react';
import CreateChain, { mapStateToProps } from '../../components/CreateChain';
import { fetchUserPubkey } from '../../components/User/user.actions'
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import { xabiMock } from './createChainMock';

describe('CreateChain: index', () => {

  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  });

  describe('render component', () => {

    test('with empty values', () => {
      const props = {
        fetchUserPubkey : () => {"undefined"},
        isOpen: false,
        isSpinning: false,
        error: null,
        store: store
      };

      const wrapper = shallow(
        <CreateChain.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        fetchUserPubkey : () => {"undefined"},
        isOpen: true,
        isSpinning: false,
        error: null,
        store: store
      };

      const wrapper = shallow(
        <CreateChain.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  test('isValidFileType', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      openCreateChainOverlay: jest.fn(),
      closeCreateChainOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <CreateChain.WrappedComponent {...props} />
    ).dive().dive().dive();

    const solFiles = [
      {
        name: 'file1.sol',
        size: 1111,
        type: ''
      }
    ]

    const solFiles1 = [
      {
        name: 'file1',
        size: 1111,
        type: ''
      }
    ]

    expect(wrapper.instance().isValidFileType(solFiles)).toMatchSnapshot();
    expect(wrapper.instance().isValidFileType(solFiles1)).toMatchSnapshot();
    expect(wrapper.instance().isValidFileType(null)).toMatchSnapshot();
  });

  test('errorMessageFor', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      openCreateChainOverlay: jest.fn(),
      closeCreateChainOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <CreateChain.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper.instance().errorMessageFor('chainName')).toMatchSnapshot();
    wrapper.setState({ errors: { chainName: 'required' } })
    expect(wrapper.instance().errorMessageFor('chainName')).toMatchSnapshot()
  });

  test('submit form', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      abi: xabiMock,
      openCreateChainOverlay: jest.fn(),
      closeCreateChainOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      createChain: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <CreateChain.WrappedComponent {...props} />
    ).dive().dive().dive();

    let dialog = wrapper.find('Dialog');
    dialog.find('Button').last().simulate('click');
    expect(props.handleSubmit).toHaveBeenCalled();
    expect(props.handleSubmit).toHaveBeenCalledTimes(1);

    const payload = {
      "chainName": "airline cartel 1",
      "addRule": "MajorityRules",
      "removeRule": "MajorityRules",
      "members": [
        {
          "username": "tanuj1000",
          "address": "f11b5c42f5b84efa07f6b0a32c3fc545ff509126",
          "enode": "enode://",
          "balance": 1000
        }
      ],
      "governanceContract": "contract SimpleStorage {\n  uint public storedData;\n}"
    }

    wrapper.instance().updateMembers(payload.members[0]);
    wrapper.instance().submit(payload);
    expect(props.createChain).toHaveBeenCalled();
    expect(props.createChain).toHaveBeenCalledTimes(1);
  });

  test('remove members', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      openCreateChainOverlay: jest.fn(),
      closeCreateChainOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      createChain: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <CreateChain.WrappedComponent {...props} />
    ).dive().dive().dive();

    const payload = {
      "username": "tanuj1000",
      "address": "f11b5c42f5b84efa07f6b0a32c3fc545ff509126",
      "enode": "enode://",
      "balance": 1000
    }

    wrapper.instance().updateMembers(payload);
    expect(wrapper.state('members')).toMatchSnapshot();
    wrapper.instance().removeMember("tanuj1000");
    expect(wrapper.state('members')).toMatchSnapshot();
  });

  test('open modal', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      openCreateChainOverlay: jest.fn(),
      closeCreateChainOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store,
      userCertificate: { userAddress: "4567890" }
    };

    const wrapper = shallow(
      <CreateChain.WrappedComponent {...props} />
    ).dive().dive().dive();

    wrapper.find('AnchorButton').first().simulate('click');
    expect(props.openCreateChainOverlay).toHaveBeenCalled();
    expect(props.openCreateChainOverlay).toHaveBeenCalledTimes(1);
  });

  test('close modal', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      openCreateChainOverlay: jest.fn(),
      closeCreateChainOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <CreateChain.WrappedComponent {...props} />
    ).dive().dive().dive();

    let dialog = wrapper.find('Dialog');
    dialog.get(0).props.onClose();
    dialog.find('Button').first().simulate('click');
    expect(props.closeCreateChainOverlay).toHaveBeenCalled();
    expect(props.closeCreateChainOverlay).toHaveBeenCalledTimes(2);
  });

  test('componentWillReceiveProps', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      createErrorMessage: 'error',
      openCreateChainOverlay: jest.fn(),
      closeCreateChainOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <CreateChain.WrappedComponent {...props} />
    ).dive().dive().dive();

    wrapper.instance().componentWillReceiveProps(props);
    expect(props.resetError).toHaveBeenCalled();
    expect(props.resetError).toHaveBeenCalledTimes(1);
  });

  test('mapStateToProps with default state', () => {
    const state = {
      createChain: {
        isOpen: true,
        spinning: true,
        error: null,
        contractName: 'Governance',
        abi: xabiMock
      },
      user : {
        publicKey : "undefined"
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});