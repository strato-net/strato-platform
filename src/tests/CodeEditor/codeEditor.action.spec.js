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

describe('Test code editor actions', () => {

  test('should create an action to check code and decide to enable/disable create contract', () => {
    expect(changeCreateActionState(false, 'abc', 0)).toMatchSnapshot();
  });

  test('should create an action to compile code', () => {
    expect(compileCodeFromEditor('code')).toMatchSnapshot();
  });

  test('should create an action on code compile success', () => {
    expect(compileCodeFromEditorSuccess(extAbi)).toMatchSnapshot();
  });

  test('should create an action on code compile failure', () => {
    expect(compileCodeFromEditorFailure(error)).toMatchSnapshot();
  });

  test('should create an action to add a new file tab', () => {
    expect(addNewFileTab('New file', 'content')).toMatchSnapshot();
  });

  test('should remove tab on close filename', () => {
    expect(removeTab(0)).toMatchSnapshot();
  });

  test('should change tab', () => {
    expect(onTabChange(0, 1)).toMatchSnapshot();
  });

  test('should change contract name', () => {
    expect(contractNameChange('Abc')).toMatchSnapshot();
  });

  test('should create an action on file name change', () => {
    expect(onChangeFileName('New modified file name')).toMatchSnapshot();
  });

  test('should compile file locally', () => {
    expect(onCompileFileLocally(error)).toMatchSnapshot();
  });

});