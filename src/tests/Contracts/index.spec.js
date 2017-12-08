import React from 'react';
import Contracts from '../../components/Contracts/index';

test('renders contracts', () => {
  const props = {
    error: null,
    filter: '',
    contracts: {},
    fetchContracts: () => { },
    changeContractFilter: () => { }
  }
  let wrapper = shallow(
    <Contracts.WrappedComponent {...props} />
  );
  expect(wrapper).toMatchSnapshot();
});


