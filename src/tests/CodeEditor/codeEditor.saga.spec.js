import {
  watchCompileSourceFromEditor,
  compileCodeFromEditor,
  compileSource,
  tokenizeSource
} from '../../components/CodeEditor/codeEditor.saga';
import {
  takeEvery,
  call,
  put
} from 'redux-saga/effects';
import {
  CODE_EDITOR_COMPILE_REQUEST,
  compileCodeFromEditorSuccess,
  compileCodeFromEditorFailure
} from '../../components/CodeEditor/codeEditor.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { extAbi, error } from './codeEditorMock'

describe('Test contracts saga', () => {

  test('should watch contracts', () => {
    const gen = watchCompileSourceFromEditor();
    expect(gen.next().value).toEqual(takeEvery(CODE_EDITOR_COMPILE_REQUEST, compileCodeFromEditor))
  })

  describe('fetchContracts generator', () => {

    test('inspection 1', () => {
      const gen = compileCodeFromEditor({ type: "CODE_EDITOR_COMPILE_REQUEST", code: '' });
      expect(gen.next().value).toEqual(call(tokenizeSource, ''));
      expect(gen.next().value).toEqual(put(compileCodeFromEditorSuccess()));
      expect(gen.next().done).toBe(true);
    })

    test('inspection 2', () => {
      const gen = compileCodeFromEditor({ type: "CODE_EDITOR_COMPILE_REQUEST", code: '' });
      expect(gen.next().value).toEqual(call(tokenizeSource, ''));
      expect(gen.next(extAbi).value).toEqual(call(compileSource, 'Cloner', ''))
      expect(gen.next().value).toEqual(put(compileCodeFromEditorSuccess(extAbi)));
      expect(gen.next().done).toBe(true);
    })

    test('inspection 3', () => {
      const gen = compileCodeFromEditor({ type: "CODE_EDITOR_COMPILE_REQUEST", code: '' });
      expect(gen.next().value).toEqual(call(tokenizeSource, ''));
      expect(gen.next(extAbi).value).toEqual(call(compileSource, 'Cloner', ''))
      expect(gen.throw(error).value).toEqual(put(compileCodeFromEditorFailure(error)));
      expect(gen.next().done).toBe(true);
    })

    test('should compile code with success', (done) => {
      fetch.mockResponse(JSON.stringify(extAbi));
      expectSaga(compileCodeFromEditor, { type: "CODE_EDITOR_COMPILE_REQUEST", code: '' })
        .call.fn(tokenizeSource).put.like({ action: { type: 'CODE_EDITOR_COMPILE_SUCCESS' } })
        .run().then((result) => { done() });
    });

    test('should compile code with response ok as false', (done) => {
      fetch.mockResponse(JSON.stringify(extAbi), { ok: false, status: 300 });
      expectSaga(compileCodeFromEditor, { type: "CODE_EDITOR_COMPILE_REQUEST", code: '' })
        .call.fn(tokenizeSource).put.like({ action: { type: 'CODE_EDITOR_COMPILE_FAILURE' } })
        .run().then((result) => { done() });
    });

    test('should compile code with failure', (done) => {
      fetch.mockReject(JSON.stringify(error));
      expectSaga(compileCodeFromEditor, { type: "CODE_EDITOR_COMPILE_REQUEST", code: '' })
        .call.fn(tokenizeSource).put.like({ action: { type: 'CODE_EDITOR_COMPILE_FAILURE' } })
        .run().then((result) => { done() });
    });

    test('should compile code with exception', () => {
      expectSaga(compileCodeFromEditor)
        .provide({
          call() {
            throw new Error('Not Found');
          },
        })
        .put.like({ action: { type: 'CODE_EDITOR_COMPILE_FAILURE' } })
        .run();
    });

  });

})

