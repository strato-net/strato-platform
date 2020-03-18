import React from 'react';
import UplaodFile, { mapStateToProps } from '../../../components/ExternalStorage/UploadFile';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import * as checkMode from '../../../lib/checkMode';

describe('UploadFile: index', () => {
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
        isOpen: false,
        uploadError: null,
        result: null,
        closeUploadModal: jest.fn(),
        resetError: jest.fn(),
        fetchAccounts: jest.fn()
      }

      const wrapper = shallow(
        <UplaodFile.WrappedComponent {...props} />
      ).find('Dialog');

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        isOpen: true,
        uploadError: null,
        result: {
          contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
          uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
          metadata: 'widescreen is one of the most important factor'
        },
        closeUploadModal: jest.fn(),
        resetError: jest.fn(),
        fetchAccounts: jest.fn()
      }

      const wrapper = shallow(
        <UplaodFile.WrappedComponent {...props} />
      ).find('Dialog');

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('render component (Oauth mode)', () => {
    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    })

    test('without values', () => {
      const props = {
        isOpen: false,
        uploadError: null,
        result: null,
        closeUploadModal: jest.fn(),
        resetError: jest.fn(),
        fetchAccounts: jest.fn()
      }

      const wrapper = shallow(
        <UplaodFile.WrappedComponent {...props} />
      ).find('Dialog');

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        isOpen: true,
        uploadError: null,
        result: {
          contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
          uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
          metadata: 'widescreen is one of the most important factor'
        },
        closeUploadModal: jest.fn(),
        resetError: jest.fn(),
        fetchAccounts: jest.fn()
      }

      const wrapper = shallow(
        <UplaodFile.WrappedComponent {...props} />
      ).find('Dialog');

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('Oauth Mode', () => {

    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    })

    test('componentWillReceiveProps', () => {
      const props = {
        isOpen: true,
        uploadError: null,
        result: {},
        closeUploadModal: jest.fn(),
        resetError: jest.fn(),
        fetchAccounts: jest.fn()
      }

      const wrapper = shallow(
        <UplaodFile.WrappedComponent {...props} />
      );

      wrapper.setProps({ uploadError: 'error' });

      expect(props.resetError).toHaveBeenCalledTimes(1);
      expect(props.resetError).toHaveBeenCalled();
    });

  });

  describe('Non Oauth Mode', () => {

    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    })

    test('componentDidMount', () => {
      const props = {
        isOpen: true,
        uploadError: 'error',
        result: {},
        closeUploadModal: jest.fn(),
        resetError: jest.fn(),
        fetchAccounts: jest.fn()
      }

      const wrapper = shallow(
        <UplaodFile.WrappedComponent {...props} />
      );

      expect(props.fetchAccounts).toHaveBeenCalledTimes(1);
      expect(props.fetchAccounts).toHaveBeenCalled();
    });

    test('componentWillReceiveProps', () => {
      const props = {
        isOpen: true,
        uploadError: null,
        result: {},
        closeUploadModal: jest.fn(),
        resetError: jest.fn(),
        fetchAccounts: jest.fn()
      }

      const wrapper = shallow(
        <UplaodFile.WrappedComponent {...props} />
      );

      wrapper.setProps({ uploadError: null });

      expect(props.resetError).toHaveBeenCalledTimes(0);
      expect(props.resetError).not.toHaveBeenCalled();
    });

  });

  describe('mapStateToProps', () => {

    test('without values', () => {
      const state = {
        uploadFile: {
          isOpen: false,
          error: null,
          result: null
        }
      }

      expect(mapStateToProps(state)).toMatchSnapshot();
    });

    test('with values', () => {
      const state = {
        uploadFile: {
          isOpen: true,
          error: 'error',
          result: {
            contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
            uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
            metadata: 'widescreen is one of the most important factor'
          }
        }
      }

      expect(mapStateToProps(state)).toMatchSnapshot();
    });

  });

  describe('Dialog', () => {

    test('simulate onClose', () => {
      const props = {
        isOpen: true,
        uploadError: null,
        result: {
          contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
          uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
          metadata: 'widescreen is one of the most important factor'
        },
        closeUploadModal: jest.fn(),
        resetError: jest.fn(),
        fetchAccounts: jest.fn()
      }

      const wrapper = shallow(
        <UplaodFile.WrappedComponent {...props} />
      );

      let Dialog = wrapper.find('Dialog').dive().get(0);
      Dialog.props.onClose();

      expect(props.closeUploadModal).toHaveBeenCalledTimes(1);
      expect(props.closeUploadModal).toHaveBeenCalled();
    });

  });

});