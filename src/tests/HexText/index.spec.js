import React from 'react';
import HexText from '../../components/HexText';

describe('Hextext: index', () => {

  describe('render component', () => {
    test('without values', () => {
      const props = {};

      const wrapper = shallow(
        <HexText {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        value: 'Hextext Name',
        classes: 'class'
      };

      const wrapper = shallow(
        <HexText {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });
  });

  describe('clipboard', () => {
    test('copy text', () => {
      const props = {
        value: 'Hextext Name',
        classes: 'class'
      };

      const wrapper = shallow(
        <HexText {...props} />
      );

      wrapper.find('span').at(1).simulate('click', { stopPropagation() { }, preventDefault() { } });
      wrapper.find('CopyToClipboard').get(0).props.onCopy();
      expect(wrapper.state('copied')).toBe(true);
    })

    test('reset copied', () => {
      const props = {
        value: 'Hextext Name',
        classes: 'class'
      };

      const wrapper = mount(
        <HexText {...props} />
      );

      wrapper.setState({ copied: true });
      wrapper.find('span').at(3).simulate('mouseOut');
      expect(wrapper.state('copied')).toBe(false);
    })
  });

});