import React from 'react';
import Transactions, { mapStateToProps } from '../../components/Transactions/index';

describe('Transactions: index', () => {

  test('render with empty values', () => {
    const wrapper = shallow(
      <Transactions />
    );
    expect(wrapper).toMatchSnapshot();
  });

})