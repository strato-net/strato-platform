import {
    CODE_EDITOR_COMPILE,
    CODE_EDITOR_COMPILE_SUCCESS,
    CODE_EDITOR_COMPILE_FAILURE
  } from './codeEditor.actions';
  
  const initialState = {
    compileSuccess: false,
    abi: undefined,
    response: "Status: Upload Source Code",
    filename: undefined,
    createDisabled: true,    
  };
  
  
  const reducer = function (state = initialState, action) {
    switch (action.type) {
      case CODE_EDITOR_COMPILE:
        return {
          ...state,
          response: "Uploading Source Code...",
          createDisabled: true
        };
      case CODE_EDITOR_COMPILE_SUCCESS:
        return {
          ...state,
          response: "Error Uploading Source Code...: " + action.error,
          error: action.error,
          createDisabled: true,
        };
      case CODE_EDITOR_COMPILE_FAILURE:
        return {
          ...state,
          abi: action.response,
          createDisabled: false,
        };
      default:
        return state;
    }
  };
  
  export default reducer;
  