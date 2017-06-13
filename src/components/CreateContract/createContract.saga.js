import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_CONTRACT,
  createContractSuccess,
  createContractFailure,
  COMPILE_CONTRACT,
  compileContractSuccess,
  compileContractFailure
} from './createContract.actions';
import {
  fetchContracts
} from '../Contracts/contracts.actions';

import { NODES } from '../../env';

const url = NODES[0].url + "/bloc/v2.1/users/:user/:address/contract"
const compileUrl = NODES[0].url + "/strato-api/eth/v1.2/extabi";

function getAddress(username) {
  const getAddressUrl = NODES[0].url + "/bloc/v2.1/users/" + username
  return fetch(
    getAddressUrl,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
    })
    .then(function(response) {
      return response.json();
    })
    .catch(function(error) {
      throw error;
    });
}

function createContractApiCall(source, username, password, args) {
  getAddress(username).then(function(res) {
    let addr = res[0];
    let src = source.replace(/\s+/g, " ");
    return fetch(
      url.replace(":user", username).replace(":address", addr),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({password, src, args})
      })
      .then(function(response) {
        return response;
      })
      .then(function(res) {
        return res;
      })
      .catch(function(error) {
        throw error;
      });
  })
}

function compileContractApiCall(src) {
    return fetch(
      compileUrl,
      {
        method: 'POST',
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "src="+encodeURIComponent(src)
      })
      .then(function(response) {
        return response.json();
      })
      .then(function(res) {
        return res;
      })
      .catch(function(error) {
        throw error;
      });
}

function* createContract(action) {
  try {
    let response = yield call(createContractApiCall, action.payload.fileText,
      action.payload.username, action.payload.password, action.payload.arguments);
    yield put(fetchContracts());
    yield put(createContractSuccess(response));
  }
  catch (err) {
    yield put(createContractFailure(err));
  }
}

function* compileContract(action) {
  try {
    let response = yield call(compileContractApiCall, action.contract);
    yield put(compileContractSuccess(response));
  }
  catch (err) {
    yield put(compileContractFailure(err));
  }

}

export function* watchCompileContract() {
  yield takeLatest(COMPILE_CONTRACT, compileContract);
}

export default function* watchCreateContract() {
  yield takeLatest(CREATE_CONTRACT, createContract);
}
