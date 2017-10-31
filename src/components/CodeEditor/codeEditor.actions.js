export const CODE_EDITOR_COMPILE_REQUEST = "CODE_EDITOR_COMPILE_REQUEST";
export const CODE_EDITOR_COMPILE_SUCCESS = "CODE_EDITOR_COMPILE_SUCCESS";
export const CODE_EDITOR_COMPILE_FAILURE = "CODE_EDITOR_COMPILE_FAILURE";
export const CODE_EDITOR_CHANGE_CREATEACTION = "CODE_EDITOR_CHANGE_CREATEACTION"; 
export const ADD_NEW_TAB = "ADD_NEW_TAB";
export const REMOVE_TAB = "REMOVE_TAB";
export const ON_TAB_CHANGE = "ON_TAB_CHANGE";
export const EDITOR_CONTRACT_NAME_CHANGE = "EDITOR_CONTRACT_NAME_CHANGE"

export const changeCreateActionState = function(value, sourceCode, index){
  return {
    type: CODE_EDITOR_CHANGE_CREATEACTION,
    createActionEnable: value,
    sourceCode: sourceCode,
    index
  }
} 

export const compileCodeFromEditor = function(name, code, searchable) {
    return {
      type: CODE_EDITOR_COMPILE_REQUEST,
      name: name,
      code: code,
      searchable: searchable
    }
  }

  export const compileCodeFromEditorSuccess = function(response) {
    return {
      type: CODE_EDITOR_COMPILE_SUCCESS,
      response: response,
    }
  }
  
  export const compileCodeFromEditorFailure = function(error) {
    return {
      type: CODE_EDITOR_COMPILE_FAILURE,
      error: error,
    }
  }

  export const addNewFileTab = function (fileName) {
    return {
      type: ADD_NEW_TAB,
      fileName: fileName
    }
  }

  export const removeTab = function (index) {
    return {
      type: REMOVE_TAB,
      index: index
    }
  }

  export const onTabChange = function (prevTab, nextTab) {
    return {
      type: ON_TAB_CHANGE,
      prevTab: prevTab,
      nextTab: nextTab
    }
  }

  export const contractNameChange = function(contractName) {
    return {
      type: EDITOR_CONTRACT_NAME_CHANGE,
      contractName: contractName
    }
  }