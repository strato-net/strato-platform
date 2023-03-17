import React from 'react';
import DeployDapp, { mapStateToProps } from '../../components/DeployDapp';
import { fetchUserPubkey } from '../../components/User/user.actions'
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import { xabiMock } from './deployDappMock';

describe('DeployDapp: index', () => {

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
        <DeployDapp.WrappedComponent {...props} />
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
        <DeployDapp.WrappedComponent {...props} />
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
      openDeployDappOverlay: jest.fn(),
      closeDeployDappOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <DeployDapp.WrappedComponent {...props} />
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
      openDeployDappOverlay: jest.fn(),
      closeDeployDappOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <DeployDapp.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper.instance().errorMessageFor('dappName')).toMatchSnapshot();
    wrapper.setState({ errors: { dappName: 'required' } })
    expect(wrapper.instance().errorMessageFor('dappName')).toMatchSnapshot()
  });

  test('submit form', () => {
    const props = {
      textFromEditor: 'contract A {}',
      sourceFromEditor: 'contract A {}',
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      abi: xabiMock,
      openDeployDappOverlay: jest.fn(),
      closeDeployDappOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      deployDapp: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store,
      vm: true,
      fileText: 'contract A {}',
      members: [
        {
          "username": "tanuj1000",
          "address": "f11b5c42f5b84efa07f6b0a32c3fc545ff509126",
          "enode": "enode://",
          "balance": 1000
        }
      ],
      integrations: [],
    };

    const wrapper = shallow(
      <DeployDapp.WrappedComponent {...props} />
    ).dive().dive().dive();

    let dialog = wrapper.find('Dialog');
    dialog.find('Button').last().simulate('click');
    expect(props.handleSubmit).toHaveBeenCalled();
    expect(props.handleSubmit).toHaveBeenCalledTimes(1);

    const payload = {
      "dappName": "airline cartel 1",
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
      "integrations": [],
      "governanceContract": "contract SimpleStorage {\n  uint public storedData;\n}",
      "chainName": "MajorityRules"
    }

    wrapper.instance().updateMembers(payload.members[0]);
    wrapper.instance().submit(payload);
    expect(props.deployDapp).toHaveBeenCalled();
    expect(props.deployDapp).toHaveBeenCalledTimes(1);
  });

  test('remove members', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      deployDappOpenModal: jest.fn(),
      deployDappCloseModal: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      deployDapp: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <DeployDapp.WrappedComponent {...props} />
    ).dive().dive().dive();

    const payload = {
      "orgName": "BlockApps",
      "orgUnit": "Engineering"
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
      deployDappOpenModal: jest.fn(),
      deployDappCloseModal: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store,
      userCertificate: { userAddress: "456789"}
    };

    const wrapper = shallow(
      <DeployDapp.WrappedComponent {...props} />
    ).dive().dive().dive();

    wrapper.find('AnchorButton').first().simulate('click');
    expect(props.deployDappOpenModal).toHaveBeenCalled();
    expect(props.deployDappOpenModal).toHaveBeenCalledTimes(1);
  });

  test('close modal', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      deployDappOpenModal: jest.fn(),
      deployDappCloseModal: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <DeployDapp.WrappedComponent {...props} />
    ).dive().dive().dive();

    let dialog = wrapper.find('Dialog');
    dialog.get(0).props.onClose();
    dialog.find('Button').first().simulate('click');
    expect(props.deployDappCloseModal).toHaveBeenCalled();
    expect(props.deployDappCloseModal).toHaveBeenCalledTimes(2);
  });

  test('componentWillReceiveProps', () => {
    const props = {
      fetchUserPubkey : fetchUserPubkey,
      isOpen: false,
      isSpinning: false,
      error: null,
      createErrorMessage: 'error',
      deployDappOpenModal: jest.fn(),
      deployDappCloseModal: jest.fn(),
      handleSubmit: jest.fn(),
      resetError: jest.fn(),
      touch: jest.fn(),
      reset: jest.fn(),
      store: store,
      isToasts: true
    };

    const wrapper = shallow(
      <DeployDapp.WrappedComponent {...props} />
    ).dive().dive().dive();

    wrapper.instance().componentWillReceiveProps(props);
    expect(props.resetError).toHaveBeenCalled();
    expect(props.resetError).toHaveBeenCalledTimes(1);
  });

  test('mapStateToProps with default state', () => {
    const state = {
      deployDapp: {
        isOpen: true,
        spinning: true,
        error: null,
        contractName: 'Governance',
        abi: xabiMock
      },
      codeEditor: {
        codeType: 'SolidVM'
      },
      user : {
        publicKey : "undefined"
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});