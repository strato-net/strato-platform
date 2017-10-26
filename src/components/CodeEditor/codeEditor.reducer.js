import {
  CODE_EDITOR_COMPILE_REQUEST,
  CODE_EDITOR_COMPILE_SUCCESS,
  CODE_EDITOR_COMPILE_FAILURE,
  CODE_EDITOR_CHANGE_CREATEACTION,
  ADD_NEW_TAB,
  REMOVE_TAB,
  ON_TAB_CHANGE
} from './codeEditor.actions';

const initialState = {
  codeCompileSuccess: undefined,
  abi: undefined,
  filename: undefined,
  createDisabled: true,
  enableCreateAction: false,
  sourceCode: undefined,
  contractName: undefined,
  tab: [{
    text: '',
    title: 'untitled'
  }],
  lastTabSelected:0
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case CODE_EDITOR_COMPILE_REQUEST:
      return {
        ...state,
        response: "Uploading Contract...",
        createDisabled: true,
        enableCreateAction: false
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
        response: "Error Uploading Contract...: " + action.error,
        error: action.error,
        codeCompileSuccess: false,
        enableCreateAction: false
      };

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
      const id = state.tab.length + 1
      return {
        ...state,
        tab: [...state.tab, { title: `untitled${id}`, text: '' }]
      };

    case REMOVE_TAB:
      const tabs = state.tab.slice();
      tabs.splice(action.index, 1);
      return {
        ...state,
        tab: tabs
      };

    case ON_TAB_CHANGE:
      const changedTab = state.tab.slice();
      const text = changedTab[action.nextTab] && changedTab[action.nextTab].text
      return {
        ...state,
        tab:changedTab,
        sourceCode: text,
        lastTabSelected:action.nextTab
      }

    default:
      return state;
  }
};

export default reducer;
