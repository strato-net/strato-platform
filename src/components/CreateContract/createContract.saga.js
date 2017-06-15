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

import { env } from '../../env';

const url = env.BLOC_URL + "/users/:user/:address/contract"
const compileUrl = env.STRATO_URL + "/extabi";

function createContractApiCall(contract, src, username, address, password, args) {
  return fetch(
    url.replace(":user", username).replace(":address", address),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({contract, value:0, password, src, args})
    }
  )
  .then(function(response) {
    return response.json();
  })
  .catch(function(error) {
    throw error;
  });
}

function compileContractApiCall(name,src) {
    return fetch(
      compileUrl,
      {
        method: 'POST',
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body:
          "src="+encodeURIComponent(src)
        })
      .then(function(response) {
        return response.json();
      })
      .catch(function(error) {
        throw error;
      });
}

function* createContract(action) {
  try {
    let response = yield call(
        createContractApiCall,
        action.payload.contract,
        action.payload.fileText,
        action.payload.username,
        action.payload.address,
        action.payload.password,
        action.payload.arguments
      );
    yield put(createContractSuccess(response));
    yield put(fetchContracts());
  }
  catch (err) {
    yield put(createContractFailure(err));
  }
}

function* compileContract(action) {
  try {
    let response = yield call(compileContractApiCall, action.name, action.contract);
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
