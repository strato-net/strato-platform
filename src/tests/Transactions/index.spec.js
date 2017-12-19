import React from 'react';
import Transactions, { mapStateToProps } from '../../components/Transactions/index';

describe('Test contracts index', () => {

  test('should render transactions with empty values', () => {
    const wrapper = shallow(
      <Transactions />
    );
    expect(wrapper).toMatchSnapshot();
  });

})