import React from 'react';
import ReactDOM from 'react-dom';
import registerServiceWorker from './registerServiceWorker';
import './index.css';

import { Provider } from 'react-redux';

import App from './App/App'
import { BrowserRouter as Router } from 'react-router-dom'
import {
  createStore,
  applyMiddleware,
  combineReducers
} from 'redux';
import createSagaMiddleware from 'redux-saga';

import { routerReducer } from 'react-router-redux';
import { reducer as formReducer } from 'redux-form';
import {reducer as burgerMenu} from 'redux-burger-menu';


const rootReducer = combineReducers({
  form: formReducer,
  routing: routerReducer,
  burgerMenu
});

const rootSaga = function* startForeman() {
  yield [
    // YOUR SAGAS HERE
  ]
};

// create the saga middleware
const sagaMiddleware = createSagaMiddleware();
// mount it on the Store
const store = createStore(
  rootReducer,
  applyMiddleware(sagaMiddleware),
  window.devToolsExtension ? window.devToolsExtension() : f => f,
);

// then run the saga
sagaMiddleware.run(rootSaga);

ReactDOM.render(
  <Provider store={store}>
    <Router>
      <App />
    </Router>
  </Provider>,
  document.getElementById('root')
);
registerServiceWorker();
