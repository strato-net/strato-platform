import {
  compileCodeFromEditor,
  compileCodeFromEditorFailure,
  compileCodeFromEditorSuccess,
  changeCreateActionState,
  addNewFileTab,
  removeTab,
  onTabChange,
  contractNameChange,
  onChangeFileName,
  onCompileFileLocally
} from '../../components/CodeEditor/codeEditor.actions';
import { extAbi, error } from './codeEditorMock';

describe('CodeEditor: action', () => {

  test('change create action state', () => {
    expect(changeCreateActionState(false, 'abc', 0)).toMatchSnapshot();
  });

  describe('compile code', () => {

    test('request', () => {
      expect(compileCodeFromEditor('code')).toMatchSnapshot();
    });

    test('success', () => {
      expect(compileCodeFromEditorSuccess(extAbi)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(compileCodeFromEditorFailure(error)).toMatchSnapshot();
    });

  })

  test('add new tab', () => {
    expect(addNewFileTab('New file', 'content')).toMatchSnapshot();
  });

  test('remove tab', () => {
    expect(removeTab(0)).toMatchSnapshot();
  });

  test('change tab', () => {
    expect(onTabChange(0, 1)).toMatchSnapshot();
  });

  test('change contract name', () => {
    expect(contractNameChange('Abc')).toMatchSnapshot();
  });

  test('on file name change', () => {
    expect(onChangeFileName('New modified file name')).toMatchSnapshot();
  });

  test('compile file locally', () => {
    expect(onCompileFileLocally(error)).toMatchSnapshot();
  });

});