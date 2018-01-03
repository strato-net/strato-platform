import React from 'react';
import ValueInput from '../../components/ValueInput';

describe('ValueInput: index', () => {

  describe('render component', () => {
    test('without value', () => {
      const props = {
        name: undefined,
        placeholder: undefined,
        title: undefined
      };

      const wrapper = shallow(
        <ValueInput {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        name: 'block',
        placeholder: 'block',
        title: 'block'
      };

      const wrapper = shallow(
        <ValueInput {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });
  });

  describe('dropdown', () => {
    test('render options', () => {
      const props = {
        name: 'block',
        placeholder: 'block',
        title: 'block',
        input: {
          onChange: jest.fn()
        }
      };

      const wrapper = shallow(
        <ValueInput {...props} />
      );

      expect(wrapper.find('select').get(0)).toMatchSnapshot();
    });

    test('select value', () => {
      const props = {
        name: 'block',
        placeholder: 'block',
        title: 'block',
        input: {
          onChange: jest.fn()
        }
      };

      const wrapper = shallow(
        <ValueInput {...props} />
      );

      wrapper.find('select').simulate('change', { target: { value: 'babbage' } });
      expect(props.input.onChange).toHaveBeenCalled();
      expect(props.input.onChange.mock.calls.length).toBe(1);
      expect(wrapper.state('denomination')).toBe('babbage');
    });
  });

  describe('input', () => {
    test('update value', () => {
      const props = {
        name: 'block',
        placeholder: 'block',
        title: 'block',
        input: {
          onChange: jest.fn()
        }
      };

      const wrapper = shallow(
        <ValueInput {...props} />
      );

      wrapper.find('input').simulate('change', { target: { value: 155 } });
      expect(props.input.onChange).toHaveBeenCalled();
      expect(props.input.onChange.mock.calls.length).toBe(1);
      expect(wrapper.state('rawValue')).toBe(155);
    });
  });

});