import reducer from '../../components/CodeEditor/codeEditor.reducer';
import { extAbi, error } from "./codeEditorMock";
import {
  compileCodeFromEditor,
  compileCodeFromEditorFailure,
  compileCodeFromEditorSuccess,
  contractNameChange,
  changeCreateActionState,
  addNewFileTab,
  removeTab,
  onTabChange,
  onChangeFileName,
  onCompileFileLocally
} from '../../components/CodeEditor/codeEditor.actions';
import { deepClone } from '../helper/testHelper';

describe('Test contracts reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // CODE_EDITOR_COMPILE_REQUEST
  test('should compile code', () => {
    const action = compileCodeFromEditor('code');

    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    };

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // CODE_EDITOR_COMPILE_SUCCESS
  test('should store tokenized code after success', () => {
    const action = compileCodeFromEditorSuccess(extAbi);
    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    };
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // CODE_EDITOR_COMPILE_FAILURE
  test('should store error after failure', () => {
    const action = compileCodeFromEditorFailure(error);
    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    };
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // EDITOR_CONTRACT_NAME_CHANGE
  test('should change contract name', () => {
    const action = contractNameChange('Cloner');

    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // CODE_EDITOR_CHANGE_CREATEACTION
  test('should change state of create action', () => {
    const action = changeCreateActionState(false, 'abc', 0);
    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // ADD_NEW_TAB
  test('should create new tab', () => {
    const action = addNewFileTab('New File', {
      text: '',
      title: 'Main2.sol'
    });
    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // REMOVE_TAB
  test('should remove tab at index', () => {
    const action = removeTab(0);
    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // ON_TAB_CHANGE, isRemoveTab:false
  test('should change tab with remove tab value as false', () => {
    const action = onTabChange(0, 1);
    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      },
      {
        text: '',
        title: 'Main2.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // ON_TAB_CHANGE, isRemoveTab: true
  test('should change tab with isRemoveTab value as true', () => {
    const action = onTabChange(0, 1);
    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      },
      {
        text: '',
        title: 'Main2.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: true,
      localCompileException: ''
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // CHANGE_FILE_NAME
  test('should change file name', () => {
    const action = onChangeFileName('New file name');
    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // ON_COMPILE_FILE_LOCALLY
  test('should compile file locally', () => {
    const action = onCompileFileLocally(error);
    const initialState = {
      codeCompileSuccess: undefined,
      abi: undefined,
      fileName: undefined,
      createDisabled: true,
      enableCreateAction: false,
      sourceCode: undefined,
      contractName: undefined,
      tab: [{
        text: '',
        title: 'Main.sol'
      }],
      lastTabSelected: 0,
      currentTabSelected: 0,
      isRemoveTab: false,
      localCompileException: ''
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

})
