import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  CREATE_USER,
  createUserSuccess,
  createUserFailure,
} from './createUser.actions';

const APIURL = "http://bayar6.eastus.cloudapp.azure.com/" //FIXME hard coded api url
const url = APIURL + "bloc/users/:user"

function createUserApiCall(username, password) {
  return fetch(
    url.replace(":user", username),
    {
      method: 'POST',
      headers: {
        'Accept' : 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: "faucet=1&password="+password
    })
    .then(function(response) {
      return response;
    })
    .catch(function(error) {
      throw error;
    });
}

function* createUser(action) {
  try {
    let response = yield call(createUserApiCall, action.username, action.password);
    yield put(createUserSuccess(response));
  }
  catch (err) {
    yield put(createUserFailure(err));
  }
}

export default function* watchCreateUser() {
  yield takeLatest(CREATE_USER, createUser);
}
