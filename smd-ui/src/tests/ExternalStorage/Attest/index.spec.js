import React from 'react';
import Attest, { mapStateToProps } from '../../../components/ExternalStorage/Attest';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import { accountsMock, indexAccountsMock } from '../../Accounts/accountsMock';
import * as checkMode from '../../../lib/checkMode';
import { mockAttestFormData } from './mockAttest';

describe('Verify: index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  describe('render component (non Oauth mode)', () => {
    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    })

    test('without values', () => {
      const props = {
        accounts: accountsMock,
        username: null,
        isLoading: false,
        initialValues: {
          username: null,
          address: null
        },
        resetError: jest.fn(),
        reset: jest.fn(),
        attestDocument: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handleSubmit: jest.fn(),
        closeAttestModal: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Attest.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        accounts: indexAccountsMock,
        username: 'Admin_1177_49507',
        isLoading: true,
        initialValues: {
          username: 'Admin_1177_49507',
          address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        attestResult: {
          "attested": true,
          "signers": [
            "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad",
            "a51f27e78aef85a06631f0725f380001e0ae9fb6"
          ]
        },
        resetError: jest.fn(),
        reset: jest.fn(),
        attestDocument: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handleSubmit: jest.fn(),
        closeAttestModal: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Attest.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('render component (Oauth mode)', () => {
    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    })

    test('without values', () => {
      const props = {
        accounts: accountsMock,
        username: null,
        isLoading: false,
        initialValues: {
          username: null,
          address: null
        },
        resetError: jest.fn(),
        reset: jest.fn(),
        attestDocument: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handleSubmit: jest.fn(),
        closeAttestModal: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Attest.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        accounts: indexAccountsMock,
        username: 'Admin_1177_49507',
        isLoading: true,
        initialValues: {
          username: 'Admin_1177_49507',
          address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        attestResult: {
          "attested": true,
          "signers": [
            "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad",
            "a51f27e78aef85a06631f0725f380001e0ae9fb6"
          ]
        },
        resetError: jest.fn(),
        reset: jest.fn(),
        attestDocument: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handleSubmit: jest.fn(),
        closeAttestModal: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Attest.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('Non Oauth mode', () => {

    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    })

    test('on dialog close', () => {
      const props = {
        accounts: indexAccountsMock,
        username: 'Admin_1177_49507',
        isLoading: false,
        initialValues: {
          username: 'Admin_1177_49507',
          address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        resetError: jest.fn(),
        reset: jest.fn(),
        attestDocument: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handleSubmit: jest.fn(),
        closeAttestModal: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Attest.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.find('Dialog').get(0).props.onClose();
      expect(props.closeAttestModal).toHaveBeenCalled();
      expect(props.closeAttestModal).toHaveBeenCalledTimes(1);

    });

    test('simulate close button', () => {
      const props = {
        accounts: indexAccountsMock,
        username: 'Admin_1177_49507',
        isLoading: false,
        initialValues: {
          username: 'Admin_1177_49507',
          address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        attestResult: {
          "attested": true,
          "signers": [
            "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad",
            "a51f27e78aef85a06631f0725f380001e0ae9fb6"
          ]
        },
        resetError: jest.fn(),
        reset: jest.fn(),
        attestDocument: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handleSubmit: jest.fn(),
        closeAttestModal: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Attest.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.find('Button').at(0).simulate('click');
      expect(props.closeAttestModal).toHaveBeenCalled();
      expect(props.closeAttestModal).toHaveBeenCalledTimes(1);
    });

    describe('Form:', () => {

      test('values in field', () => {
        const props = {
          accounts: indexAccountsMock,
          username: 'Admin_1177_49507',
          isLoading: false,
          initialValues: {
            username: 'Admin_1177_49507',
            address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
          },
          resetError: jest.fn(),
          reset: jest.fn(),
          attestDocument: jest.fn(),
          changeUsername: jest.fn(),
          fetchUserAddresses: jest.fn(),
          handleSubmit: jest.fn(),
          closeAttestModal: jest.fn(),
          store: store
        }

        const wrapper = shallow(
          <Attest.WrappedComponent {...props} />
        ).dive().dive().dive();

        wrapper.find('Field').first().simulate('change', { target: { value: 'Admin_1085_64667' } });
        wrapper.find('Field').at(1).simulate('change', { target: { value: 'd2263b71c14010ff03d8f786670aba691b22b158' } });
        wrapper.find('Field').at(2).simulate('change', { target: { value: 'password' } });
        wrapper.find('Field').last().simulate('change', { target: { value: '9fe7af972b28469858d6ea78b06dbefb0b8f4edb' } });
        expect(store.getState('form')).toMatchSnapshot();
      });

      test('submit with values', () => {
        const props = {
          accounts: indexAccountsMock,
          username: 'Admin_1177_49507',
          isLoading: false,
          initialValues: {
            username: 'Admin_1177_49507',
            address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
          },
          resetError: jest.fn(),
          reset: jest.fn(),
          attestDocument: jest.fn(),
          changeUsername: jest.fn(),
          fetchUserAddresses: jest.fn(),
          handleSubmit: jest.fn(),
          closeAttestModal: jest.fn(),
          store: store
        }

        const wrapper = shallow(
          <Attest.WrappedComponent {...props} />
        ).dive().dive().dive();

        wrapper.instance().submit(mockAttestFormData);
        expect(props.attestDocument).toHaveBeenCalled();
        expect(props.attestDocument).toHaveBeenCalledTimes(1);
        expect(wrapper.state()).toMatchSnapshot();
      });

      test('submit without values', () => {
        const props = {
          accounts: indexAccountsMock,
          username: 'Admin_1177_49507',
          isLoading: false,
          initialValues: {
            username: 'Admin_1177_49507',
            address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
          },
          resetError: jest.fn(),
          reset: jest.fn(),
          attestDocument: jest.fn(),
          changeUsername: jest.fn(),
          fetchUserAddresses: jest.fn(),
          handleSubmit: jest.fn(),
          closeAttestModal: jest.fn(),
          store: store
        }

        const wrapper = shallow(
          <Attest.WrappedComponent {...props} />
        ).dive().dive().dive();

        wrapper.instance().submit({});
        expect(props.attestDocument).not.toHaveBeenCalled();
        expect(props.attestDocument).not.toHaveBeenCalledTimes(1);
        expect(wrapper.state()).toMatchSnapshot();
      });

    });

  });

  describe('componentWillReceiveProps', () => {

    test('with values', () => {
      const props = {
        accounts: indexAccountsMock,
        username: 'Admin_1177_49507',
        isLoading: false,
        initialValues: {
          username: 'Admin_1177_49507',
          address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        resetError: jest.fn(),
        reset: jest.fn(),
        attestDocument: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handleSubmit: jest.fn(),
        closeAttestModal: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Attest.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().componentWillReceiveProps({ attestError: 'error' });

      expect(props.resetError).toHaveBeenCalledTimes(1);
      expect(props.resetError).toHaveBeenCalled();
    });

    test('without values', () => {
      const props = {
        accounts: indexAccountsMock,
        username: 'Admin_1177_49507',
        isLoading: false,
        initialValues: {
          username: 'Admin_1177_49507',
          address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        resetError: jest.fn(),
        reset: jest.fn(),
        attestDocument: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handleSubmit: jest.fn(),
        closeAttestModal: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Attest.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().componentWillReceiveProps({});

      expect(props.resetError).not.toHaveBeenCalledTimes(1);
      expect(props.resetError).not.toHaveBeenCalled();
    });

  });

  test('mapStateToProps', () => {
    const state = {
      attest: {
        isOpen: true,
        error: 'error',
        attestDocument: {
          "uri": "https://strato-external-storage.s3.amazonaws.com/1530165910145-widescreen.jpeg",
          "timeStamp": 1530165910,
          "signers": [
            "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad"
          ]
        },
        username: 'tanuj1000',
        isLoading: false
      },
      accounts: {
        accounts: accountsMock
      },
      user: {
        oauthUser: {
          username: 'tanuj1000',
          address: '6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad'
        }
      }

    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  })

});