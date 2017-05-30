import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  FETCH_ACCOUNTS,
  fetchAccountsSuccess,
  fetchAccountsFailure
} from './accounts.actions';

const APIURL = "http://strato-int.centralus.cloudapp.azure.com/" //FIXME hard coded api url
const addressUrl = APIURL + "bloc/addresses"

function getAccounts() {
  return fetch(
    addressUrl,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(function(response) {
      return response.json()
    })
    .then(function (res) {
      return Promise.all(getAccountData(res)).then(function(res) {
        return res.map(val => {return val[0]}); // flatten resulting array of account objects
      });
    })
    .catch(function(error) {
      throw error;
    });
}

function getAccountData(addresses) {
  var accountDataUrl = APIURL + "strato-api/eth/v1.2/account?address=:address"
  var rtn = addresses.map(function (value) {
    return fetch(
      accountDataUrl.replace(":address", value),
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
      })
      .then(function(response) {
        return response.json()
      })
      .catch(function(error) {
        throw error;
      });
  });
  return rtn;
}

function* fetchAccounts(action) {
  try {
    let response = yield call(getAccounts);
    yield put(fetchAccountsSuccess(response));
  }
  catch (err) {
    yield put(fetchAccountsFailure(err));
  }
}

export default function* watchFetchAccounts() {
  yield takeEvery(FETCH_ACCOUNTS, fetchAccounts);
}
