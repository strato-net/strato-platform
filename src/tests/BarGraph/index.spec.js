import React from 'react';
import BarGraph from '../../components/BarGraph';
import { dashboard } from '../Dashboard/dashboardMock';

describe('Test BarGraph index', () => {

  test('should render component properly', () => {
    const props = {
      data: dashboard.blockDifficulty,
      label: "Difficulty",
      identifier: "Difficulty"
    };

    const wrapper = render(
      <BarGraph {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  })

})