import React from 'react';
import ReactDOM from 'react-dom';
import registerServiceWorker from './registerServiceWorker';

import { Provider } from 'react-redux';
import { HashRouter as Router } from 'react-router-dom'
import { createStore, applyMiddleware, combineReducers, compose } from 'redux';
import createSagaMiddleware from 'redux-saga';
import { all } from 'redux-saga/effects';
import { fork } from 'redux-saga/effects';
import App from "./App/App";
import { reducer as formReducer } from 'redux-form';
import { loadingBarReducer, loadingBarMiddleware } from 'react-redux-loading-bar'

// Reducers
import AppsReducer from './components/Apps/apps.reducer';
import loginReducer from './components/Login/login.reducer';
import registerReducer from './components/Register/register.reducer';

// sagas
import watchFetchApps from './components/Apps/apps.saga';
import watchValidateUser from './components/Login/login.saga';
import watchCreateUser from './components/Register/register.saga';


const rootReducer = combineReducers({
 form: formReducer,
 apps: AppsReducer,
 login: loginReducer,
 register: registerReducer,
 loadingBar: loadingBarReducer
});

// YOUR SAGAS HERE
const rootSaga = function* startForeman() {
 yield all([
   fork(watchFetchApps),
   fork(watchValidateUser),
   fork(watchCreateUser)
 ])
};

// create the saga middleware
const sagaMiddleware = createSagaMiddleware();

const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
const loadignBarMiddleware =  loadingBarMiddleware({
  promiseTypeSuffixes: ['REQUEST', 'SUCCESS', 'FAILURE'],
})
// mount it on the Store
const store = createStore(rootReducer,
 process.env.NODE_ENV !== 'production' ? composeEnhancers(applyMiddleware(sagaMiddleware,loadignBarMiddleware)) :
   applyMiddleware(sagaMiddleware, loadignBarMiddleware), );

// then run the saga
sagaMiddleware.run(rootSaga);

ReactDOM.render(
 <Provider store={store}>
   <Router>
     <App />
   </Router>
 </Provider>, document.getElementById('root'));
registerServiceWorker();