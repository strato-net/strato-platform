import React from 'react';
import ContractCard from '../../../../components/Contracts/components/ContractCard/index';


describe('Test ContractCard index', () => {
  
  test('renders contract with empty values', () => {
    const props = {
      contract: '',
      fetchCirrusInstances: () => { },
      fetchAccount: () => { },
      fetchState: () => { },
      selectContractInstance: () => { }
    }

    let wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );
    expect(wrapper).toMatchSnapshot();
  });

  test('render contract with mocked values', () => {
    const props = {
      contract: {name: 'Greeter', contract: {"instances": [
        {
          "createdAt": 1512481078000,
          "address": "0293f9b10a4453667db7fcfe74728c9d821add4b",
          "fromBloc": true
        }
      ]}},
      fetchCirrusInstances: () => { },
      fetchAccount: () => { },
      fetchState: () => { },
      selectContractInstance: () => { }
    }
    
    let wrapper = shallow(
      <ContractCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

});
