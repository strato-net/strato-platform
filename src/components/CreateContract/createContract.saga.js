import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_CONTRACT,
  createContractSuccess,
  createContractFailure,
} from './createContract.actions';

const APIURL = "http://bayar6.eastus.cloudapp.azure.com/" //FIXME hard coded api url
const url = APIURL + "bloc/users/:user/:address/contract"

function getAddress(username) {
  let getAddressUrl = APIURL+ "bloc/users/" + username
  return fetch(
    getAddressUrl,
    {
      method: 'GET',
      headers: {
        'Accept' : 'text/html',
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

function createContractApiCall(source, username, password) {
  getAddress(username).then(function(res) {
    let addr = res[0];
    let src = source.replace(/\s+/g, " ");
    let args = { "_greeting" : "hello"};
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
        console.log(res, res.text());
        return res;
      })
      .catch(function(error) {
        throw error;
      });
  })
}

function* createContract(action) {
  try {
    let response = yield call(createContractApiCall, action.payload.fileText, action.payload.username, action.payload.password);
    console.log(response);
    yield put(createContractSuccess(response));
  }
  catch (err) {
    yield put(createContractFailure(err));
  }
}

export default function* watchCreateContract() {
  yield takeLatest(CREATE_CONTRACT, createContract);
}