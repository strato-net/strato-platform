import React from 'react';
import ContractMethodCall from '../../../../components/Contracts/components/ContractMethodCall/index';

describe('Test ContractMethodCall index', () => {
    
  test('renders contracts card with empty props', () => {
    const  props = {}
    let wrapper = shallow(
      <ContractMethodCall.WrappedComponent {...props} />
    );
    expect(wrapper).toMatchSnapshot();
  });

});


