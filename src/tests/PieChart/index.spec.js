import React from 'react';
import PieChart from '../../components/PieChart';
import { dashboard } from '../Dashboard/dashboardMock';

describe('Test PieChart index', () => {

  test('should render component properly', () => {
    const props = {
      data: dashboard.transactionTypes
    };

    const wrapper = render(
      <PieChart {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  })

})