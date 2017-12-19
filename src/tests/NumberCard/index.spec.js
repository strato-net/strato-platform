import React from 'react';
import NumberCard from '../../components/NumberCard/index';

describe('Test NumberCard index', () => {

  it('should render with mocked values', () => {
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

  it('should render with empty values', () => {
    const props = {};

    const wrapper = shallow(
      <NumberCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

});