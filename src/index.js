import React from 'react';
import ReactDOM from 'react-dom';
import registerServiceWorker from './registerServiceWorker';

import {Provider} from 'react-redux';
import {BrowserRouter as Router} from 'react-router-dom'
import {
    createStore,
    applyMiddleware,
    combineReducers,
} from 'redux';
import createSagaMiddleware from 'redux-saga';
import { fork } from 'redux-saga/effects';
import {routerReducer} from 'react-router-redux';
import {reducer as formReducer} from 'redux-form';
import {reducer as burgerMenu} from 'redux-burger-menu';

import App from "./App/App.js";


import blockDataReducer from './components/BlockData/block-data.reducer'
import transactionsReducer from './components/Transactions/transactions.reducer'
import createUserReducer from './components/CreateUser/createUser.reducer'
import createContractReducer from './components/CreateContract/createContract.reducer'

import watchFetchBlockData from './components/BlockData/block-data.saga'
import watchFetchTx from './components/Transactions/transactions.saga'

const rootReducer = combineReducers({
  form: formReducer,
  routing: routerReducer,
  // YOUR REDUCERS HERE
  burgerMenu,
  blockData: blockDataReducer,
  transactions: transactionsReducer,
  createUser: createUserReducer,
  createContract: createContractReducer,
});

const rootSaga = function* startForeman() {
    yield [
        // YOUR SAGAS HERE
        fork(watchFetchBlockData),
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
