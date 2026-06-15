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

describe('CodeEditor: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('compile code', () => {

    // CODE_EDITOR_COMPILE_REQUEST
    test('request', () => {
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
    test('success', () => {
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
    test('failure', () => {
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

  })

  // EDITOR_CONTRACT_NAME_CHANGE
  test('change contract name', () => {
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
  test('change create action state', () => {
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
  test('create new tab', () => {
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
  test('remove tab at index', () => {
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

  describe('on tab change with isRemoveTab value', () => {
    // ON_TAB_CHANGE, isRemoveTab:false
    test('false', () => {
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
    test('true', () => {
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

  })

  // CHANGE_FILE_NAME
  test('change file name', () => {
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
  test('compile file locally', () => {
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
