import React from 'react';
import Nodes from '../../components/Nodes/index';

describe('Nodes: index', () => {

  test('render correctly', () => {
    const wrapper = shallow(
      <Nodes />
    );
    expect(wrapper).toMatchSnapshot();
  });

});

