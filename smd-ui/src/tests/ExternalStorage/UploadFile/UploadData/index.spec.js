import React from 'react';
import UploadData from '../../../../components/ExternalStorage/UploadFile/UploadData';

describe('UploadData: index', () => {

  describe('render component', () => {

    test('without values', () => {
      const props = {
        result: {
          contractAddress: null,
          uri: null,
          metadata: null
        },
        closeModal: jest.fn()
      }

      const wrapper = shallow(
        <UploadData {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        result: {
          contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
          uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
          metadata: 'widescreen is one of the most important factor'
        },
        closeModal: jest.fn()
      }

      const wrapper = shallow(
        <UploadData {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  test('Simulate close modal button', () => {
    const props = {
      result: {
        contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
        uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
        metadata: 'widescreen is one of the most important factor'
      },
      closeModal: jest.fn()
    }

    const wrapper = shallow(
      <UploadData {...props} />
    );

    wrapper.find('Button').simulate('click');
    expect(props.closeModal).toHaveBeenCalled();
    expect(props.closeModal).toHaveBeenCalledTimes(1);
  });
  
});