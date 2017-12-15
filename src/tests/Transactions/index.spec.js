import React from 'react';
import Transactions, { mapStateToProps } from '../../components/Transactions/index';
import ReactTestUtils from 'react-dom/test-utils';
import renderer from "react-test-renderer";
import { data, updatedData } from '../TransactionList/transactionListMock';

describe('Test contracts index', () => {

  test('should render transactions with empty values', () => {
    const wrapper = shallow(
      <Transactions />
    );
    expect(wrapper).toMatchSnapshot();
  });

})