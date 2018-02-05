import React from 'react';
import Blocks from '../../components/Blocks/index';

describe('Blocks: index', () => {

  test('render stateless component', () => {
    const wrapper = shallow(
      <Blocks />
    );
    expect(wrapper).toMatchSnapshot();
  });

});