import {
  CODE_EDITOR_COMPILE_REQUEST,
  CODE_EDITOR_COMPILE_SUCCESS,
  CODE_EDITOR_COMPILE_FAILURE,
  CODE_EDITOR_CHANGE_CREATEACTION,
  ADD_NEW_TAB,
  REMOVE_TAB,
  ON_TAB_CHANGE,
  EDITOR_CONTRACT_NAME_CHANGE,
  CHANGE_FILE_NAME,
  ON_COMPILE_FILE_LOCALLY
} from './codeEditor.actions';

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
  localCompileException: '',
  codeType : "SolidVM"
};

const formatCompilationErrors = function (error) {
  if (typeof error !== "string") {
    return "Failed to connect to the Strato compiler."
  }
  if (error.indexOf('\n') === -1) {
    const jsonErr = JSON.parse(error);
    return jsonErr.replace(/\n/g, "\n");
  }
  let text = error
    .split('\n')
    .reduce((a, part, i) => {
      if (i === 0 || part === '') {
        return a;
      }
      return a + ' ' + part;
    }, '');

  try {
    const jErrors = JSON.parse(text);
    return jErrors.error;
  } catch (e) {
    return text;
  }
}

export const loadState = () => {
  try {
    const serializedState = localStorage.getItem('code_editor_state');
    if (serializedState === null) {
      return initialState;
    }
    return JSON.parse(serializedState);
  } catch (err) {
    return undefined;
  }
};

const reducer = function (state = loadState(), action) {
  switch (action.type) {
    case CODE_EDITOR_COMPILE_REQUEST:
      return {
        ...state,
        response: "Uploading Contract...",
        createDisabled: true,
        enableCreateAction: false,
        codeType : action.codeType
      };

    case CODE_EDITOR_COMPILE_SUCCESS:
      let contracts = action.response && action.response.src && Object.keys(action.response.src);
      return {
        ...state,
        contractName: contracts && contracts[0],
        response: action.response,
        codeCompileSuccess: true,
        enableCreateAction: true
      };

    case CODE_EDITOR_COMPILE_FAILURE:
      return {
        ...state,
        response: formatCompilationErrors(action.error),
        error: action.error,
        codeCompileSuccess: false,
        enableCreateAction: false
      };

    case EDITOR_CONTRACT_NAME_CHANGE:
      return {
        ...state,
        contractName: action.contractName
      }

    case CODE_EDITOR_CHANGE_CREATEACTION:
      const tabItems = [...state.tab];
      tabItems[action.index].text = action.sourceCode;  //new value
      return {
        ...state,
        enableCreateAction: action.createActionEnable,
        sourceCode: action.sourceCode,
        tab: tabItems
      };

    case ADD_NEW_TAB:
      const newTabs = [...state.tab, { title: `${action.fileName}.sol`, text: action.fileContent }]
      return {
        ...state,
        tab: newTabs,
        sourceCode: action.fileContent,
        currentTabSelected: newTabs.length - 1,
        enableCreateAction: false
      };

    case REMOVE_TAB:
      const tabs = state.tab.slice();
      tabs.splice(action.index, 1);
      const selectedTab = action.index === state.currentTabSelected ? (action.index > 0 ? state.currentTabSelected - 1 : 0) : (action.index > state.currentTabSelected ? state.currentTabSelected : state.currentTabSelected - 1)
      return {
        ...state,
        tab: tabs,
        isRemoveTab: true,
        currentTabSelected: selectedTab,
        lastTabSelected: selectedTab
      };

    case ON_TAB_CHANGE:
      const changedTab = state.tab.slice();
      if (state.isRemoveTab) {
        const tabCodeOnRemove = changedTab.length > 0 && changedTab.splice(state.currentTabSelected, 1)
        return {
          ...state,
          isRemoveTab: false,
          sourceCode: tabCodeOnRemove.length > 0 && tabCodeOnRemove[0].text,
          enableCreateAction: false
        }
      }
      const tabCode = changedTab.splice(action.nextTab, 1)
      return {
        ...state,
        sourceCode: tabCode[0].text,
        currentTabSelected: action.nextTab,
        lastTabSelected: action.prevTab,
        enableCreateAction: false
      }

    case CHANGE_FILE_NAME:
      return {
        ...state,
        fileName: action.name
      }

    case ON_COMPILE_FILE_LOCALLY:
      return {
        ...state,
        localCompileException: action.compileError
      }

    default:
      return state;
  }
};

export default reducer;
