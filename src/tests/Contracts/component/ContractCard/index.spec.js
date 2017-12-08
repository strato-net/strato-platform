import React from 'react';
import ContractCard from '../../../../components/Contracts/components/ContractCard/index';

const props = {
  contract: '',
  fetchCirrusInstances: () => { },
  fetchAccount: () => { },
  fetchState: () => { },
  selectContractInstance: () => { }
}

test('renders contracts card', () => {
  let wrapper = shallow(
    <ContractCard.WrappedComponent {...props} />
  );
  expect(wrapper).toMatchSnapshot();
});


