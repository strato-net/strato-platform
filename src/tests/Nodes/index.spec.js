import React from 'react';
import Nodes from '../../components/Nodes/index';
import renderer from 'react-test-renderer';

test('renders correctly', () => {
  const node = renderer.create(<Nodes/>).toJSON();
  expect(node).toMatchSnapshot();
});

