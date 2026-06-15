import React from 'react';
import List, { mapStateToProps } from '../../../components/ExternalStorage/List';
import { uploadList } from '../storageMock';

describe('List: index', () => {

  describe('render component', () => {

    test('without values', () => {
      const props = {
        uploadList: []
      };

      const wrapper = shallow(
        <List {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        uploadList: uploadList
      };

      const wrapper = shallow(
        <List {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

});