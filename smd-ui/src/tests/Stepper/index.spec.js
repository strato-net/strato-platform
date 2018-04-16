import Stepper from '../../components/Stepper'
import React from 'react'

describe('Stepper: index', () => {

  describe('render component', () => {
  
    test('for step 0', () => {
      const props = { step: 0 }
      const wrapper = shallow(
        <Stepper {...props} />
      );
      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('for step 1', () => {
      const props = { step: 1 }
      const wrapper = shallow(
        <Stepper {...props} />
      );
      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('for step 2', () => {
      const props = { step: 2 }
      const wrapper = shallow(
        <Stepper {...props} />
      );
      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('for step 3', () => {
      const props = { step: 3 }
      const wrapper = shallow(
        <Stepper {...props} />
      );
      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('for step 4', () => {
      const props = { step: 4 }
      const wrapper = shallow(
        <Stepper {...props} />
      );
      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('default step', () => {
      const wrapper = shallow(
        <Stepper />
      );
      expect(wrapper.debug()).toMatchSnapshot();
    });

  })

})