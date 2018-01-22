import React from 'react';
import ReactDOM from 'react-dom';
import registerServiceWorker from './registerServiceWorker';

import { Provider } from 'react-redux';
import { HashRouter as Router } from 'react-router-dom'
import { createStore, applyMiddleware, combineReducers } from 'redux';
import createSagaMiddleware from 'redux-saga';
import { all } from 'redux-saga/effects';
import { fork } from 'redux-saga/effects';
import App from "./App/App";

// Reducers
import AppsReducer from './components/Apps/apps.reducer';

// sagas
import watchFetchApps from './components/Apps/apps.saga';

const rootReducer = combineReducers({
  apps: AppsReducer
});

// YOUR SAGAS HERE
const rootSaga = function* startForeman() {
  yield all([
    fork(watchFetchApps)
  ])
};

// create the saga middleware
const sagaMiddleware = createSagaMiddleware();

// mount it on the Store
const store = createStore(rootReducer,
  window.__REDUX_DEVTOOLS_EXTENSION__ && window.__REDUX_DEVTOOLS_EXTENSION__(),
  applyMiddleware(sagaMiddleware));

// then run the saga
sagaMiddleware.run(rootSaga);

ReactDOM.render(
  <Provider store={store}>
    <Router>
      <App />
    </Router>
  </Provider>, document.getElementById('root'));
registerServiceWorker();

