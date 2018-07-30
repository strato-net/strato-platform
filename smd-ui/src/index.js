import React from 'react';
import ReactDOM from 'react-dom';
import { unregister as unregisterServiceWorker } from './registerServiceWorker';

import { Provider } from 'react-redux';
import { HashRouter as Router } from 'react-router-dom'
import { createStore, applyMiddleware, combineReducers, compose } from 'redux';
import createSagaMiddleware from 'redux-saga';
import { fork, all } from 'redux-saga/effects';
import { routerReducer } from 'react-router-redux';
import { reducer as formReducer } from 'redux-form';
import { loadingBarReducer, loadingBarMiddleware } from 'react-redux-loading-bar'
import App from "./App/";

import dashboardReducer from './components/Dashboard/dashboard.reducer';
import accountsReducer from './components/Accounts/accounts.reducer';
import blockDataReducer from './components/BlockData/block-data.reducer'
import createUserReducer from './components/CreateUser/createUser.reducer';
import createContractReducer from './components/CreateContract/createContract.reducer';
import contractsReducer from './components/Contracts/contracts.reducer';
import contractQueryReducer from './components/ContractQuery/contractQuery.reducer';
import methodCallReducer from './components/Contracts/components/ContractMethodCall/contractMethodCall.reducer';
import nodeCardReducer from './components/NodeCard/nodeCard.reducer';
import transactionsReducer from './components/TransactionList/transactionList.reducer';
import tourReducer from './components/Tour/tour.reducer';
import queryEngineReducer from './components/QueryEngine/queryEngine.reducer';
import sendTokensReducer from './components/Accounts/components/SendTokens/sendTokens.reducer';
import userReducer from './components/User/user.reducer';
import codeEditorReducer from './components/CodeEditor/codeEditor.reducer';
import applicationsReducer from './components/Applications/applications.reducer';
import launchPadReducer from './components/LaunchPad/launchPad.reducer';
import cliReducer from './components/CLI/cli.reducer';
import walkThroughReducer from './components/WalkThrough/walkThrough.reducer';
import tokenRequestReducer from './components/TokenRequest/tokenRequest.reducer';
import verifyAccountReducer from './components/VerifyAccount/verifyAccount.reducer';
import createBlocUserReducer from './components/CreateBlocUser/createBlocUser.reducer';
import externalStorageReducer from './components/ExternalStorage/externalStorage.reducer';
import uploadFileReducer from './components/ExternalStorage/UploadFile/uploadFile.reducer';
import attestReducer from './components/ExternalStorage/Attest/attest.reducer';
import verifyReducer from './components/ExternalStorage/Verify/verify.reducer';
import downloadReducer from './components/ExternalStorage/Download/download.reducer';
import chainsReducer from './components/Chains/chains.reducer'
import createChainReducer from './components/CreateChain/createChain.reducer';

import { watchCommunicateOverSocket } from './sockets/socket.saga'
import watchFetchBlockData from './components/BlockData/block-data.saga'
import watchFetchTx from './components/TransactionList/transactionList.saga'
import watchCreateUser from './components/CreateUser/createUser.saga';
import watchCreateContract from './components/CreateContract/createContract.saga';
import { watchCompileSourceFromEditor } from './components/CodeEditor/codeEditor.saga';
import watchFetchAccounts from './components/Accounts/accounts.saga';
import { watchCompileContract } from './components/CreateContract/createContract.saga';
import watchFetchContracts from './components/Contracts/contracts.saga';
import watchFetchUser from './components/User/user.saga';
import {
  watchFetchState,
  watchFetchCirrusContracts,
  watchAccount
} from './components/Contracts/components/ContractCard/contractCard.saga';
import {
  watchMethodCall,
  watchFetchArgs
} from './components/Contracts/components/ContractMethodCall/contractMethodCall.saga';
import watchExecuteQuery from './components/QueryEngine/queryEngine.saga';
import { watchQueryCirrus, watchQueryCirrusVars } from './components/ContractQuery/contractQuery.saga';
import watchSendTokens from './components/Accounts/components/SendTokens/sendTokens.saga';
import watchFetchApplications from './components/Applications/applications.saga';
import watchAppUpload from './components/LaunchPad/launchPad.saga';
import watchVerifyAccount from './components/VerifyAccount/verifyAccount.saga';
import watchCreateBlocUser from './components/CreateBlocUser/createBlocUser.saga';
import watchFetchUpload from './components/ExternalStorage/externalStorage.saga';
import watchUploadFile from './components/ExternalStorage/UploadFile/uploadFile.saga';
import watchFetchChains from './components/Chains/chains.saga';
import watchCreateChain from './components/CreateChain/createChain.saga';

import { CREATE_USER_SUCCESS } from './components/CreateUser/createUser.actions';

const rootReducer = combineReducers({
  form: formReducer.plugin({
    'create-user': (state, action) => {
      switch (action.type) {
        case CREATE_USER_SUCCESS:
          return undefined;
        default:
          return state;
      }
    }
  }),
  routing: routerReducer,
  // YOUR REDUCERS HERE
  accounts: accountsReducer,
  blockData: blockDataReducer,
  chains: chainsReducer,
  contracts: contractsReducer,
  contractQuery: contractQueryReducer,
  createContract: createContractReducer,
  createUser: createUserReducer,
  methodCall: methodCallReducer,
  node: nodeCardReducer,
  transactions: transactionsReducer,
  queryEngine: queryEngineReducer,
  sendTokens: sendTokensReducer,
  codeEditor: codeEditorReducer,
  loadingBar: loadingBarReducer,
  tour: tourReducer,
  user: userReducer,
  applications: applicationsReducer,
  launchPad: launchPadReducer,
  dashboard: dashboardReducer,
  cli: cliReducer,
  walkThrough: walkThroughReducer,
  tokenRequest: tokenRequestReducer,
  verifyAccount: verifyAccountReducer,
  createBlocUser: createBlocUserReducer,
  uploadFile: uploadFileReducer,
  externalStorage: externalStorageReducer,
  attest: attestReducer,
  verify: verifyReducer,
  download: downloadReducer,
  createChain: createChainReducer
});

const rootSaga = function* startForeman() {
  yield all([// YOUR SAGAS HERE
    fork(watchFetchBlockData),
    fork(watchFetchTx),
    fork(watchCreateUser),
    fork(watchFetchAccounts),
    fork(watchCompileSourceFromEditor),
    fork(watchCreateContract),
    fork(watchFetchContracts),
    fork(watchCompileContract),
    fork(watchFetchState),
    fork(watchFetchArgs),
    fork(watchMethodCall),
    fork(watchFetchCirrusContracts),
    fork(watchExecuteQuery),
    fork(watchQueryCirrus),
    fork(watchQueryCirrusVars),
    fork(watchSendTokens),
    fork(watchAccount),
    fork(watchFetchApplications),
    fork(watchAppUpload),
    fork(watchCommunicateOverSocket),
    fork(watchFetchUser),
    fork(watchVerifyAccount),
    fork(watchCreateBlocUser),
    fork(watchUploadFile),
    fork(watchFetchUpload),
    fork(watchFetchChains),
    fork(watchCreateChain)
  ])
};

// create the saga middleware
const sagaMiddleware = createSagaMiddleware();

const loadingMiddleware = loadingBarMiddleware({
  promiseTypeSuffixes: ['REQUEST', 'SUCCESS', 'FAILURE']
});

const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

// mount it on the Store
const store = createStore(rootReducer, process.env.NODE_ENV !== 'production'
  ? composeEnhancers(applyMiddleware(sagaMiddleware, loadingMiddleware)) //
  : applyMiddleware(sagaMiddleware, loadingMiddleware), );

// then run the saga
sagaMiddleware.run(rootSaga);

ReactDOM.render(
  <Provider store={store}>
    <Router>
      <App />
    </Router>
  </Provider>, document.getElementById('root'));
unregisterServiceWorker();
