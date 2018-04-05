import React from 'react';
import NumberCard from '../../components/NumberCard/index';

describe('NumberCard: index', () => {

  describe('render component', () => {
    test('with values', () => {
      const props = {
        number: "HEALTH",
        description: "Network",
        mode: 'warning',
        iconClass: 'fa-exclamation-circle'
      };

      const wrapper = shallow(
        <NumberCard.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

    test('without values', () => {
      const props = {};

      const wrapper = shallow(
        <NumberCard.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });
  });

});