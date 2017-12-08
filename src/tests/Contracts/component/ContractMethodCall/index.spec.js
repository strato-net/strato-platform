import React from 'react';
import ContractMethodCall from '../../../../components/Contracts/components/ContractMethodCall/index';

test('renders contracts card', () => {
  const  props = {}
  let wrapper = shallow(
    <ContractMethodCall.WrappedComponent {...props} />
  );
  expect(wrapper).toMatchSnapshot();
});


