import React from 'react';
import HexText from '../../components/HexText';

describe('Test Hextext index', () => {

  test('should render with empty values', () => {
    const props = {};

    const wrapper = shallow(
      <HexText {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  })

  test('should render with mocked values', () => {
    const props = {
      value: 'Hextext Name',
      classes: 'class'
    };

    const wrapper = shallow(
      <HexText {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  })

  test('should copy value', () => {
    const props = {
      value: 'Hextext Name',
      classes: 'class'
    };

    const wrapper = shallow(
      <HexText {...props} />
    );

    wrapper.find('span').at(1).simulate('click', { stopPropagation() { }, preventDefault() { } }, wrapper.setState({ copied: true }))
    expect(wrapper.state('copied')).toBe(true);
  })

  test('should reset copied on mouse out', () => {
    const props = {
      value: 'Hextext Name',
      classes: 'class'
    };

    const wrapper = mount(
      <HexText {...props} />
    );

    wrapper.setState({ copied: true })
    wrapper.find('span').at(3).simulate('mouseOut');
    expect(wrapper.state('copied')).toBe(false);
  })

})