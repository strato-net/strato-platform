export const CODE_EDITOR_COMPILE = "CODE_EDITOR_COMPILE";
export const CODE_EDITOR_COMPILE_SUCCESS = "CODE_EDITOR_COMPILE_SUCCESS";
export const CODE_EDITOR_COMPILE_FAILURE = "CODE_EDITOR_COMPILE_FAILURE";
export const CODE_EDITOR_CHANGE_CREATEACTION = "CODE_EDITOR_CHANGE_CREATEACTION";

export const changeCreateActionState = function(value,sourceCode){
  return {
    type: CODE_EDITOR_CHANGE_CREATEACTION,
    createActionEnable: value,
    sourceCode: sourceCode
  }
} 

export const compileCodeFromEditor = function(name, code, searchable) {
    return {
      type: CODE_EDITOR_COMPILE,
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