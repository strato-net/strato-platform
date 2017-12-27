import React from 'react';
import Blocks from '../../components/Blocks/index';

describe('Test Blocks index', () => {

  test('should render component properly', () => {
    const wrapper = shallow(
      <Blocks />
    );

    expect(wrapper).toMatchSnapshot();
  });

});