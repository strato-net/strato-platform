import React from 'react';
import Verify, { mapStateToProps } from '../../../components/ExternalStorage/Verify';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';

describe('Verify: index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  describe('render component', () => {

    test('without values', () => {
      const props = {
        isOpen: false,
        isLoading: false,
        verifyDocument: null,
        verifyError: 'error',
        closeVerifyModal: jest.fn(),
        reset: jest.fn(),
        resetError: jest.fn(),
        verifyDocumentRequest: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <Verify.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        isOpen: true,
        isLoading: false,
        verifyDocument: {
          "uri": "https://strato-external-storage.s3.amazonaws.com/1530182373708-widescreen.jpeg",
          "timeStamp": 1531721964,
          "signers": [
            "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad",
            "a51f27e78aef85a06631f0725f380001e0ae9fb6"
          ]
        },
        verifyError: 'error',
        closeVerifyModal: jest.fn(),
        reset: jest.fn(),
        resetError: jest.fn(),
        verifyDocumentRequest: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <Verify.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('form', () => {

    test('test', () => {
      const props = {
        isOpen: false,
        isLoading: false,
        verifyDocument: null,
        verifyError: 'error',
        closeVerifyModal: jest.fn(),
        reset: jest.fn(),
        resetError: jest.fn(),
        verifyDocumentRequest: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <Verify.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.find('Field').simulate('change', { target: { value: '6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad' } });
      wrapper.find('Button').simulate('click');
      expect(props.handleSubmit).toHaveBeenCalled();
    });

    test('submit with values', () => {
      const props = {
        isOpen: false,
        isLoading: false,
        verifyDocument: null,
        verifyError: 'error',
        closeVerifyModal: jest.fn(),
        reset: jest.fn(),
        resetError: jest.fn(),
        verifyDocumentRequest: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <Verify.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({ contractAddress: '6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad' });
      expect(wrapper.state()).toMatchSnapshot();
    });

    test('submit without values', () => {
      const props = {
        isOpen: false,
        isLoading: false,
        verifyDocument: null,
        verifyError: 'error',
        closeVerifyModal: jest.fn(),
        reset: jest.fn(),
        resetError: jest.fn(),
        verifyDocumentRequest: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <Verify.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({});
      expect(wrapper.state()).toMatchSnapshot();
    });

  });

  test('simulate close button', () => {
    const props = {
      isOpen: true,
      isLoading: false,
      verifyDocument: {
        "uri": "https://strato-external-storage.s3.amazonaws.com/1530182373708-widescreen.jpeg",
        "timeStamp": null,
        "signers": [
          "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad",
          "a51f27e78aef85a06631f0725f380001e0ae9fb6"
        ]
      },
      verifyError: 'error',
      closeVerifyModal: jest.fn(),
      reset: jest.fn(),
      resetError: jest.fn(),
      verifyDocumentRequest: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <Verify.WrappedComponent {...props} />
    ).dive().dive().dive();

    wrapper.find('Button').simulate('click');
    expect(props.closeVerifyModal).toHaveBeenCalled();
    expect(props.closeVerifyModal).toHaveBeenCalledTimes(1);
  });

  describe('componentWillReceiveProps', () => {
    test('with values', () => {
      const props = {
        isOpen: false,
        isLoading: false,
        verifyDocument: null,
        verifyError: 'error',
        closeVerifyModal: jest.fn(),
        reset: jest.fn(),
        resetError: jest.fn(),
        verifyDocumentRequest: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <Verify.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().componentWillReceiveProps({ verifyError: 'error' });
      expect(props.resetError).toHaveBeenCalled();
      expect(props.resetError).toHaveBeenCalledTimes(1);
    });

    test('without values', () => {
      const props = {
        isOpen: false,
        isLoading: false,
        verifyDocument: null,
        verifyError: 'error',
        closeVerifyModal: jest.fn(),
        reset: jest.fn(),
        resetError: jest.fn(),
        verifyDocumentRequest: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <Verify.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().componentWillReceiveProps({ verifyError: null });
      expect(props.resetError).not.toHaveBeenCalled();
      expect(props.resetError).not.toHaveBeenCalledTimes(1);
    });
  });

  test('close dialog', () => {
    const props = {
      isOpen: false,
      isLoading: false,
      verifyDocument: null,
      verifyError: 'error',
      closeVerifyModal: jest.fn(),
      reset: jest.fn(),
      resetError: jest.fn(),
      verifyDocumentRequest: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <Verify.WrappedComponent {...props} />
    ).dive().dive().dive();

    wrapper.find('Dialog').get(0).props.onClose();
    expect(props.closeVerifyModal).toHaveBeenCalled();
    expect(props.closeVerifyModal).toHaveBeenCalledTimes(1);
  });

  test('mapStateToProps', () => {
    const state = {
      verify: {
        isOpen: false,
        isLoading: false,
        verifyDocument: {
          "uri": "https://strato-external-storage.s3.amazonaws.com/1530182373708-widescreen.jpeg",
          "timeStamp": 1530182371,
          "signers": [
            "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad",
            "a51f27e78aef85a06631f0725f380001e0ae9fb6"
          ]
        },
        error: null
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  })

});