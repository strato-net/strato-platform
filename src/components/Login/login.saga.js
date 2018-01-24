import {
  takeLatest,
  put,
  call
} from 'redux-saga/effects';
import {
  VALIDATE_USER_REQUEST,
  validateUserSuccess,
  validateUserFailure
} from './login.action';

import { env } from '../../env';

const url = env.BLOC_URL + "/users/:user/:address/send?resolve"
const userAddressURL = env.BLOC_URL + "/users/:user"

export function validateUserAPICall(from, fromAddress, toAddress, value, password) {
  return fetch(
    url.replace(":user", from).replace(":address", fromAddress),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value, password, toAddress })
    }
  )
    .then(function (response) {
      if (response.ok) {
        return response.json();
      } else {
        throw new Error(['Incorrect username or password']);
      }
    })
    .catch(function (error) {
      throw error;
    });
}

export function userAddressAPICall(username) {
  return fetch(
    userAddressURL.replace(":user", username),
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    }
  )
    .then(function (response) {
      if (response.ok) {
        return response.json();
      } else {
        throw new Error(['Incorrect username or password']);
      }
    })
    .catch(function (error) {
      throw error;
    });
}

export function* validateUser(action) {
  try {
    let addresses = yield call(userAddressAPICall, action.username)
    console.log(addresses)
    if (addresses && addresses.length === 0) { throw new Error(['Incorrect username or password']); }
    let response = yield call(
      validateUserAPICall,
      action.username,
      addresses[0],
      addresses[0],
      0,
      action.password
    );
    yield put(validateUserSuccess(response, action.username, addresses[0]));
  }
  catch (err) {
    yield put(validateUserFailure(err.message));
  }
}

export default function* watchValidateUser() {
  yield takeLatest(VALIDATE_USER_REQUEST, validateUser);
}
