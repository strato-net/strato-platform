import React from 'react';
import CLI from '../../components/CLI/index';

describe('CLI: index', () => {

  test('render stateless component without values', () => {
    const props = {
      addApp: false,
      closeWalkThroughOverlay: jest.fn()
    }
    const wrapper = shallow(
      <CLI.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('render stateless component with values', () => {
    const props = {
      addApp: true,
      closeWalkThroughOverlay: jest.fn()
    }
    const wrapper = shallow(
      <CLI.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

});