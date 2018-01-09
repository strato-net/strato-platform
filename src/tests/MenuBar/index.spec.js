import React from 'react';
import MenuBar, { mapStateToProps } from '../../components/MenuBar';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

describe('MenuBar: index', () => {
  let wrapper;

  beforeEach(() => {
    let store = createStore(combineReducers({ form: formReducer }));
    wrapper = shallow(
      <Provider store={store}>
        <MemoryRouter>
          <MenuBar.WrappedComponent />
        </MemoryRouter>
      </Provider>
    ).dive().dive().dive();
  })


  test('render component', () => {
    expect(wrapper.debug()).toMatchSnapshot();
  });

  describe('button', () => {
    test('execute block api', () => {
      wrapper.find('button').first().simulate('click');
      expect(wrapper.find('button').get(0)).toMatchSnapshot();
    });

    test('execute stato api', () => {
      wrapper.find('button').last().simulate('click');
      expect(wrapper.find('button').get(1)).toMatchSnapshot();
    });
  });

  test('mapStateToProps', () => {
    expect(mapStateToProps({})).toMatchSnapshot();
  });
});