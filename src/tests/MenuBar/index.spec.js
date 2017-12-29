import React from 'react';
import MenuBar, { mapStateToProps } from '../../components/MenuBar';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

describe('Test MenuCard index', () => {
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

  test('should renders correctly', () => {
    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('should execute block api link', () => {
    wrapper.find('button').first().simulate('click');
    expect(wrapper.find('button').get(0)).toMatchSnapshot();
  });

  test('should execute stato api link', () => {
    wrapper.find('button').last().simulate('click');
    expect(wrapper.find('button').get(1)).toMatchSnapshot();
  });

  test('should test mapStateToProps', () => {
    expect(mapStateToProps({})).toMatchSnapshot();
  });

});