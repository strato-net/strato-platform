import React from 'react';
import Tour, { Tour as tour, mapStateToProps } from "../../components/Tour/index";
import { tourSteps } from './tourMock';

describe('Tour: index', () => {

  describe('render component', () => {

    test('without values', () => {
      const props = {};

      const wrapper = shallow(
        <Tour.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        name: 'dashboard',
        callback: () => { },
        run: true,
        steps: tourSteps,
        autostart: true,
        endtour: () => { },
        stopAllToursFromAutostarting: () => { },
        finalStepSelector: '#accounts',
        nextPage: 'accounts',
        history: {}
      };

      const wrapper = shallow(
        <Tour.WrappedComponent {...props} />
      ).dive();

      expect(wrapper).toMatchSnapshot();
    });
  });

  test('mapStateToProps', () => {
    const state = {
      tour:
        {
          "dashboard": {
            "run": false,
            "autoStart": false
          },
          "transactions": {
            "run": false,
            "autoStart": false
          },
          "accounts": {
            "run": false,
            "autoStart": false
          },
          "contracts": {
            "run": false,
            "autoStart": false
          },
          "all": {
            "run": false,
            "autoStart": false
          }
        }
    };

    expect(mapStateToProps(state, { name: 'dashboard' })).toMatchSnapshot();
  });

});