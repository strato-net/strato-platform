import React from 'react';
import UploadForm, { mapStateToProps } from '../../../../components/ExternalStorage/UploadFile/UploadForm';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import * as checkMode from '../../../../lib/checkMode';
import { accountsMock, indexAccountsMock } from '../../../Accounts/accountsMock';
import { mockFormData } from '../mockUpload';

describe('UploadFile: index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  describe('render component (Oauth mode)', () => {
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
        uploadFileRequest: jest.fn(),
        reset: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        closeUploadModal: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <UploadForm.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        accounts: indexAccountsMock,
        username: 'User_1177_79118',
        isLoading: false,
        initialValues: {
          username: 'User_1177_79118',
          address: '33c02a81e677ea493aace735f0a6b44cfa18f44e'
        },
        uploadFileRequest: jest.fn(),
        reset: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        closeUploadModal: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <UploadForm.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('render component (Non Oauth mode)', () => {
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
        uploadFileRequest: jest.fn(),
        reset: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        closeUploadModal: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <UploadForm.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        accounts: indexAccountsMock,
        username: 'User_1177_79118',
        isLoading: false,
        initialValues: {
          username: 'User_1177_79118',
          address: '33c02a81e677ea493aace735f0a6b44cfa18f44e'
        },
        uploadFileRequest: jest.fn(),
        reset: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        closeUploadModal: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <UploadForm.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('Non oauth mode', () => {
    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    })

    test('Form input', () => {
      const props = {
        accounts: indexAccountsMock,
        username: 'User_1177_42489',
        isLoading: false,
        initialValues: {
          username: 'User_1177_42489',
          address: 'a421b5e3c34118266745dd8426a80b35513b2277'
        },
        uploadFileRequest: jest.fn(),
        reset: jest.fn(),
        changeUsername: jest.fn(),
        fetchUserAddresses: jest.fn(),
        closeUploadModal: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <UploadForm.WrappedComponent {...props} />
      ).dive().dive().dive();


      wrapper.find('Field').at(0).simulate('change', { target: { value: 'Supplier1' } });
      wrapper.find('Field').at(1).simulate('change', { target: { value: 'address' } });
      wrapper.find('Field').at(2).simulate('change', { target: { value: 'password' } });
      wrapper.find('Field').at(3).simulate('change', { target: { value: 'video' } });
      wrapper.find('Field').at(4).simulate('change', { target: { value: 's3' } });
      wrapper.find('Field').at(5).simulate('change', { target: { value: 'description' } });

      wrapper.find('Button').simulate('click');
      expect(props.handleSubmit).toHaveBeenCalled();
      expect(props.handleSubmit).toHaveBeenCalledTimes(1);
    });

    describe('onSubmit', () => {

      test('with values', () => {
        const props = {
          accounts: indexAccountsMock,
          username: 'User_1177_42489',
          isLoading: false,
          initialValues: {
            username: 'User_1177_42489',
            address: 'a421b5e3c34118266745dd8426a80b35513b2277'
          },
          uploadFileRequest: jest.fn(),
          reset: jest.fn(),
          changeUsername: jest.fn(),
          fetchUserAddresses: jest.fn(),
          closeUploadModal: jest.fn(),
          handleSubmit: jest.fn(),
          store: store
        }

        const wrapper = shallow(
          <UploadForm.WrappedComponent {...props} />
        ).dive().dive().dive();

        wrapper.instance().submit(mockFormData);
        expect(props.uploadFileRequest).toHaveBeenCalled();
        expect(props.uploadFileRequest).toHaveBeenCalledTimes(1);
      });

      test('without values', () => {
        const props = {
          accounts: indexAccountsMock,
          username: 'User_1177_42489',
          isLoading: false,
          initialValues: {
            username: 'User_1177_42489',
            address: 'a421b5e3c34118266745dd8426a80b35513b2277'
          },
          uploadFileRequest: jest.fn(),
          reset: jest.fn(),
          changeUsername: jest.fn(),
          fetchUserAddresses: jest.fn(),
          closeUploadModal: jest.fn(),
          handleSubmit: jest.fn(),
          store: store
        }

        const wrapper = shallow(
          <UploadForm.WrappedComponent {...props} />
        ).dive().dive().dive();

        wrapper.instance().submit({});
        expect(props.uploadFileRequest).not.toHaveBeenCalled();
        expect(props.uploadFileRequest).not.toHaveBeenCalledTimes(1);
      });

    });

  });

  describe('mapStateToProps', () => {

    test('without values', () => {
      const state = {
        accounts: {
          accounts: []
        },
        uploadFile: {
          username: null,
          isLoading: false
        },
        user: {
          oauthUser: {
            username: null,
            address: null
          }
        }
      }

      expect(mapStateToProps(state)).toMatchSnapshot();
    });

    test('with values', () => {
      const state = {
        accounts: {
          accounts: accountsMock
        },
        uploadFile: {
          username: 'Admin_1085_64667',
          isLoading: true
        },
        user: {
          oauthUser: {
            username: 'Admin_1085_64667',
            address: 'd2263b71c14010ff03d8f786670aba691b22b158'
          }
        }
      }

      expect(mapStateToProps(state)).toMatchSnapshot();
    });

  });

});