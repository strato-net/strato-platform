export const CODE_EDITOR_COMPILE = "CODE_EDITOR_COMPILE";
export const CODE_EDITOR_COMPILE_SUCCESS = "CODE_EDITOR_COMPILE_SUCCESS";
export const CODE_EDITOR_COMPILE_FAILURE = "CODE_EDITOR_COMPILE_FAILURE";


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
      compileSuccess: false,
      isOpen: true,
    }
  }
  
  export const compileCodeFromEditorFailure = function(error) {
    return {
      type: CODE_EDITOR_COMPILE_FAILURE,
      error: error,
      compileSuccess: false,
      isOpen: false,
    }
  }