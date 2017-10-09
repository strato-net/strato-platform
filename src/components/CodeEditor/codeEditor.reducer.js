import {
    CODE_EDITOR_COMPILE,
    CODE_EDITOR_COMPILE_SUCCESS,
    CODE_EDITOR_COMPILE_FAILURE
  } from './codeEditor.actions';
  
  const initialState = {
    codeCompileSuccess: undefined,
    abi: undefined,
    filename: undefined,
    createDisabled: true,
  };
  
  
  const reducer = function (state = initialState, action) {
    switch (action.type) {
      case CODE_EDITOR_COMPILE:
        return {
          ...state,
          response: "Uploading Contract...",
          createDisabled: true
        };
      case CODE_EDITOR_COMPILE_SUCCESS:
        return {
          ...state,
          response: action.response,
          codeCompileSuccess:true
        };
      case CODE_EDITOR_COMPILE_FAILURE:
        return {
          ...state,
          response: "Error Uploading Contract...: " + action.error,
          error: action.error,
          codeCompileSuccess:false
        };
      default:
        return state;
    }
  };
  
  export default reducer;
  