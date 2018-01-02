import React from 'react';
import ValueInput from '../../components/ValueInput';

describe('Test ValueInput index', () => {

  test('should renders correctly without mocked', () => {
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

  test('should renders correctly with mocked values', () => {
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

  test('should select value on dropdown change', () => {
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

  test('should update value on input box', () => {
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

  test('should constants renders correctly in dropdown', () => {
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

});