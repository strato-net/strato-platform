import React from 'react';
import CLI from '../../components/CLI/index';

describe('CLI: index', () => {

  test('render stateless component without values', () => {
    const props = {
      isTokenOpen: false,
      closeCLIOverlay: jest.fn()
    }
    const wrapper = shallow(
      <CLI.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('render stateless component with values', () => {
    const props = {
      isTokenOpen: true,
      closeCLIOverlay: jest.fn()
    }
    const wrapper = shallow(
      <CLI.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

});