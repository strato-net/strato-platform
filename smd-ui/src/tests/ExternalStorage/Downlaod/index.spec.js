import React from 'react';
import Download, { mapStateToProps } from '../../../components/ExternalStorage/Download';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';

describe('Download: index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  describe('render component', () => {

    test('without values', () => {
      const props = {
        isOpen: false,
        downloadError: null,
        downloadUrl: null,
        clearUrl: jest.fn(),
        downloadRequest: jest.fn(),
        handleSubmit: jest.fn(),
        closeDownloadModal: jest.fn(),
        reset: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Download.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        isOpen: true,
        downloadError: null,
        downloadUrl: null,
        clearUrl: jest.fn(),
        downloadRequest: jest.fn(),
        handleSubmit: jest.fn(),
        closeDownloadModal: jest.fn(),
        reset: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Download.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('Modal', () => {

    test('onClose', () => {
      const props = {
        isOpen: false,
        downloadError: null,
        downloadUrl: null,
        clearUrl: jest.fn(),
        downloadRequest: jest.fn(),
        handleSubmit: jest.fn(),
        closeDownloadModal: jest.fn(),
        reset: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Download.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.find('Dialog').get(0).props.onClose();
      expect(props.closeDownloadModal).toHaveBeenCalled();
      expect(props.closeDownloadModal).toHaveBeenCalledTimes(1);
    });

    test('Form', () => {
      const props = {
        isOpen: false,
        downloadError: null,
        downloadUrl: null,
        clearUrl: jest.fn(),
        downloadRequest: jest.fn(),
        handleSubmit: jest.fn(),
        closeDownloadModal: jest.fn(),
        reset: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Download.WrappedComponent {...props} />
      ).dive().dive().dive();

      const field = wrapper.find('Field');
      field.at(0).simulate('change', { target: { value: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c' } });
      wrapper.find('Button').first().simulate('click');
      expect(props.handleSubmit).toHaveBeenCalled();
    });

    test('Submit with empty value', () => {
      const props = {
        isOpen: true,
        downloadError: null,
        downloadUrl: null,
        clearUrl: jest.fn(),
        downloadRequest: jest.fn(),
        handleSubmit: jest.fn(),
        closeDownloadModal: jest.fn(),
        reset: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Download.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({});
      expect(wrapper.state()).toMatchSnapshot();
    });

    test('Submit with values', () => {
      const props = {
        isOpen: true,
        downloadError: null,
        downloadUrl: null,
        clearUrl: jest.fn(),
        downloadRequest: jest.fn(),
        handleSubmit: jest.fn(),
        closeDownloadModal: jest.fn(),
        reset: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Download.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({ contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c' });
      expect(props.downloadRequest).toHaveBeenCalled();
      expect(props.downloadRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('componentWillReceiveProps', () => {

    test('with values', () => {
      const props = {
        isOpen: true,
        downloadError: null,
        downloadUrl: null,
        clearUrl: jest.fn(),
        downloadRequest: jest.fn(),
        handleSubmit: jest.fn(),
        closeDownloadModal: jest.fn(),
        reset: jest.fn(),
        resetError: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Download.WrappedComponent {...props} />
      ).dive().dive().dive();

      // true case
      wrapper.instance().componentWillReceiveProps({ downloadError: 'error', downloadUrl: 'https://strato-external-storage.s3.amazonaws.com/1529915329415-widescreen.jpeg' });
      expect(props.resetError).toHaveBeenCalled();
      expect(props.resetError).toHaveBeenCalledTimes(1);
      expect(props.clearUrl).toHaveBeenCalled();
      expect(props.clearUrl).toHaveBeenCalledTimes(1);
    });

    test('without values', () => {
      const props = {
        isOpen: true,
        downloadError: null,
        downloadUrl: null,
        clearUrl: jest.fn(),
        downloadRequest: jest.fn(),
        handleSubmit: jest.fn(),
        closeDownloadModal: jest.fn(),
        reset: jest.fn(),
        resetError: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <Download.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().componentWillReceiveProps({});
      expect(props.resetError).not.toHaveBeenCalled();
      expect(props.clearUrl).not.toHaveBeenCalled();
    });

  });

  describe('mapStateToProps', () => {

    test('without values', () => {
      const state = {
        download: {
          isOpen: false,
          error: null,
          url: null
        }
      }

      expect(mapStateToProps(state)).toMatchSnapshot();
    });

    test('with values', () => {
      const state = {
        download: {
          isOpen: true,
          error: 'error',
          url: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg'
        }
      }

      expect(mapStateToProps(state)).toMatchSnapshot();
    });

  });

});