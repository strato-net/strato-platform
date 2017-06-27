import React from 'react';
import ReactDOM from 'react-dom';
import registerServiceWorker from './registerServiceWorker';

import {Provider} from 'react-redux';
import {HashRouter as Router} from 'react-router-dom'
import {
    createStore,
    applyMiddleware,
    combineReducers,
    compose,
} from 'redux';
import createSagaMiddleware from 'redux-saga';
import { fork } from 'redux-saga/effects';
import {routerReducer} from 'react-router-redux';
import {reducer as formReducer} from 'redux-form';

import App from "./App/";


import blockDataReducer from './components/BlockData/block-data.reducer'
import transactionsReducer from './components/TransactionList/transactionList.reducer'
import createUserReducer from './components/CreateUser/createUser.reducer'
import createContractReducer from './components/CreateContract/createContract.reducer'
import accountsReducer from './components/Accounts/accounts.reducer';
import contractsReducer from './components/Contracts/contracts.reducer';
import nodeCardReducer from './components/NodeCard/nodeCard.reducer';
import methodCallReducer from './components/Contracts/components/ContractMethodCall/contractMethodCall.reducer';
import watchFetchBlockData from './components/BlockData/block-data.saga'
import watchFetchTx from './components/TransactionList/transactionList.saga'
import watchCreateUser from './components/CreateUser/createUser.saga';
import watchCreateContract from './components/CreateContract/createContract.saga';
import { watchCompileContract } from './components/CreateContract/createContract.saga';
import watchFetchAccounts from './components/Accounts/accounts.saga';
import watchFetchContracts from './components/Contracts/contracts.saga';
import watchFetchState from './components/Contracts/components/ContractCard/contractCard.saga';
import watchFetchNodeData from './components/NodeCard/nodeCard.saga';
import { watchMethodCall, watchFetchArgs } from './components/Contracts/components/ContractMethodCall/contractMethodCall.saga';

const rootReducer = combineReducers({
  form: formReducer,
  routing: routerReducer,
  // YOUR REDUCERS HERE
  blockData: blockDataReducer,
  transactions: transactionsReducer,
  createUser: createUserReducer,
  createContract: createContractReducer,
  methodCall: methodCallReducer,
  accounts: accountsReducer,
  contracts: contractsReducer,
  nodes: nodeCardReducer
});

const rootSaga = function* startForeman() {
    yield [
        // YOUR SAGAS HERE
        fork(watchFetchBlockData),
        fork(watchFetchTx),
        fork(watchCreateUser),
        fork(watchFetchAccounts),
        fork(watchCreateContract),
        fork(watchFetchContracts),
        fork(watchCompileContract),
        fork(watchFetchState),
        fork(watchFetchNodeData),
        fork(watchFetchArgs),
        fork(watchMethodCall),
    ]
};

// create the saga middleware
const sagaMiddleware = createSagaMiddleware();

const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

// mount it on the Store
const store = createStore(
    rootReducer,
    process.env.NODE_ENV !== 'production' ?
      composeEnhancers(applyMiddleware(sagaMiddleware)) //
      : applyMiddleware(sagaMiddleware),
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
