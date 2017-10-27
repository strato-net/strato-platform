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
  
  const compileUrl = env.STRATO_URL + "/extabi";
  
  function compileSourceApiCall(contractName, source, s) {
      return fetch(
        compileUrl,
        {
          method: 'POST',
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body:
            "src="+encodeURIComponent(source)
          })
          .then(function(res) {
            if (res.ok) {
              return res.json();
            } else {
              return res.text().then(function(value) {
                  throw value;
                });
            }
          })
          .catch(function(error) {
            throw error;
          });
  }
    
  function* compileCodeFromEditor(action) {
    try {
      let response = yield call(compileSourceApiCall, action.name, action.code, action.searchable);
      yield put(compileCodeFromEditorSuccess(response));
    }
    catch (err) {
      yield put(compileCodeFromEditorFailure(err));
    }
  
  }
  
  export function* watchCompileSourceFromEditor() {
    yield takeEvery(CODE_EDITOR_COMPILE_REQUEST, compileCodeFromEditor);
  }
 