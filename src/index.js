import React from 'react';
import ReactDOM from 'react-dom';
import registerServiceWorker from './registerServiceWorker';
import './index.css';

import { Provider } from 'react-redux';
import routes from './routes';
import { BrowserRouter as Router } from 'react-router-dom'
import {
  createStore,
  applyMiddleware,
  combineReducers
} from 'redux';
import { fork } from 'redux-saga/effects';
import createSagaMiddleware from 'redux-saga';

import { routerReducer } from 'react-router-redux';
import { reducer as formReducer } from 'redux-form';

import difficultyReducer from './components/Difficulty/difficulty.reducer'
import transactionsReducer from './components/Transactions/transactions.reducer'

import watchFetchDifficulty from './components/Difficulty/difficulty.saga'
import watchFetchTx from './components/Transactions/transactions.saga'

const rootReducer = combineReducers({
  form: formReducer,
  routing: routerReducer,
  // YOUR REDUCERS HERE
  difficulty: difficultyReducer,
  transactions: transactionsReducer,
});

const rootSaga = function* startForeman() {
  yield [
    // YOUR SAGAS HERE
    fork(watchFetchDifficulty),
    fork(watchFetchTx),
  ]
};

// create the saga middleware
const sagaMiddleware = createSagaMiddleware();
// mount it on the Store
const store = createStore(
  rootReducer,
  applyMiddleware(sagaMiddleware),
  //window.devToolsExtension ? window.devToolsExtension() : f => f,
);

// then run the saga
sagaMiddleware.run(rootSaga)

ReactDOM.render(
  <Provider store={store}>
    <Router>{routes}</Router>
  </Provider>,
  document.getElementById('root')
);
registerServiceWorker();
