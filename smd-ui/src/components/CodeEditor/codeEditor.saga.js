import {
  takeEvery,
  put,
  call
} from 'redux-saga/effects';
import {
  CODE_EDITOR_COMPILE_REQUEST,
  compileCodeFromEditorSuccess,
  compileCodeFromEditorFailure
} from './codeEditor.actions';

import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';

const compileUrl = env.BLOC_URL + "/contracts/xabi";
const blocCompileUrl = env.BLOC_URL + "/contracts/compile";

export function tokenizeSource(source) {
  let body = JSON.stringify({src : source});
  return fetch(
    compileUrl,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body 
    })
    .then(function (res) {
      if (res.ok) {
        return res.json();
      } else {
        return res.text().then(function (value) {
          throw value;
        });
      }
    })
    .catch(function (error) {
      throw error;
    });
}

export function compileSource(contractName, source, codeType) {
  const searchable = [];
  return fetch(blocCompileUrl, {
    method: 'POST',
    credentials: "include",
    headers: {
      "accept": "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify([
      {
        "contractName": contractName,
        "source": source,
        "searchable": searchable,
        "vm" : codeType
      }
    ])
  })
  .then(handleErrors)
  .then(function (res) {
    if (res.ok) {
      return res.json();
    } else {
      return res.text().then(function (value) {
        throw value;
      });
    }
  })
  .then(json => {
    return Promise.resolve(json);
  })
  .catch(function (error) {
    throw error;
  });
}

export function* compileCodeFromEditor(action) {
  try {
    let response
    response = yield call(tokenizeSource, action.code);
    if (response) {
      let contracts = response.src && Object.keys(response.src);
      const contractName = contracts && contracts[0]
      yield call(compileSource, contractName, action.code, action.codeType);
    }
    yield put(compileCodeFromEditorSuccess(response));
  }
  catch (err) {
    yield put(compileCodeFromEditorFailure(err));
  }
}

export function* watchCompileSourceFromEditor() {
  yield takeEvery(CODE_EDITOR_COMPILE_REQUEST, compileCodeFromEditor);
}
