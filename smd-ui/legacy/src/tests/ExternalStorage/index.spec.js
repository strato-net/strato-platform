import React from 'react';
import ExternalStorage, { mapStateToProps } from '../../components/ExternalStorage';
import { uploadList } from './storageMock';

describe('ExternalStorage: index', () => {

  describe('render component', () => {

    test('without values', () => {
      const props = {
        uploadList: [],
        fetchUploadList: jest.fn(),
        openUploadModal: jest.fn(),
        openVerifyModal: jest.fn(),
        openAttestModal: jest.fn(),
        openDownloadModal: jest.fn()
      };

      const wrapper = shallow(
        <ExternalStorage.WrappedComponent {...props} />
      );

      expect(props.fetchUploadList).toBeCalled();
      expect(props.fetchUploadList).toHaveBeenCalledTimes(1);
      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        uploadList: uploadList,
        fetchUploadList: jest.fn(),
        openUploadModal: jest.fn(),
        openVerifyModal: jest.fn(),
        openAttestModal: jest.fn(),
        openDownloadModal: jest.fn()
      };

      const wrapper = shallow(
        <ExternalStorage.WrappedComponent {...props} />
      );

      expect(props.fetchUploadList).toBeCalled();
      expect(props.fetchUploadList).toHaveBeenCalledTimes(1);
      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('simulate button', () => {

    test('Upload', () => {
      const props = {
        uploadList: uploadList,
        fetchUploadList: jest.fn(),
        openUploadModal: jest.fn(),
        openVerifyModal: jest.fn(),
        openAttestModal: jest.fn(),
        openDownloadModal: jest.fn()
      };

      const wrapper = shallow(
        <ExternalStorage.WrappedComponent {...props} />
      );

      wrapper.find('Button').at(0).simulate('click');
      expect(props.openUploadModal).toHaveBeenCalledTimes(1);
      expect(props.openUploadModal).toHaveBeenCalled();
    });

    test('Attest', () => {
      const props = {
        uploadList: uploadList,
        fetchUploadList: jest.fn(),
        openUploadModal: jest.fn(),
        openVerifyModal: jest.fn(),
        openAttestModal: jest.fn(),
        openDownloadModal: jest.fn()
      };

      const wrapper = shallow(
        <ExternalStorage.WrappedComponent {...props} />
      );

      wrapper.find('Button').at(1).simulate('click');
      expect(props.openAttestModal).toHaveBeenCalledTimes(1);
      expect(props.openAttestModal).toHaveBeenCalled();
    });

    test('Verify', () => {
      const props = {
        uploadList: uploadList,
        fetchUploadList: jest.fn(),
        openUploadModal: jest.fn(),
        openVerifyModal: jest.fn(),
        openAttestModal: jest.fn(),
        openDownloadModal: jest.fn()
      };

      const wrapper = shallow(
        <ExternalStorage.WrappedComponent {...props} />
      );

      wrapper.find('Button').at(2).simulate('click');
      expect(props.openVerifyModal).toHaveBeenCalledTimes(1);
      expect(props.openVerifyModal).toHaveBeenCalled();
    });

    test('Download', () => {
      const props = {
        uploadList: uploadList,
        fetchUploadList: jest.fn(),
        openUploadModal: jest.fn(),
        openVerifyModal: jest.fn(),
        openAttestModal: jest.fn(),
        openDownloadModal: jest.fn()
      };

      const wrapper = shallow(
        <ExternalStorage.WrappedComponent {...props} />
      );

      wrapper.find('Button').at(3).simulate('click');
      expect(props.openDownloadModal).toHaveBeenCalledTimes(1);
      expect(props.openDownloadModal).toHaveBeenCalled();
    });

  });

  test('mapStateToProps', () => {
    const state = {
      externalStorage: {
        uploadList: uploadList
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  })

});