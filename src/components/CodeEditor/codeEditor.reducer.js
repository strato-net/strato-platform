import {
  CODE_EDITOR_COMPILE_REQUEST,
  CODE_EDITOR_COMPILE_SUCCESS,
  CODE_EDITOR_COMPILE_FAILURE,
  CODE_EDITOR_CHANGE_CREATEACTION
} from './codeEditor.actions';

const initialState = {
  codeCompileSuccess: undefined,
  abi: undefined,
  filename: undefined,
  createDisabled: true,
  enableCreateAction: false,
  sourceCode: undefined,
  contractName: undefined,
}


const formatCompilationErrors = function(error) {
  if(error.indexOf('\n') === -1) {
    return error;
  }
  let text = error
    .split('\n')
    .reduce((a,part,i)=>{
      if(i===0 || part === '') {
        return a;
      }
      return a + ' ' + part;
     },'');

  try {
    const jErrors = JSON.parse(text);
    console.log(jErrors);
    return jErrors.error;
  } catch(e) {
    return text;
  }
}

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
        response: formatCompilationErrors(action.error),
        error: action.error,
        codeCompileSuccess: false,
        enableCreateAction: false
      };

    case CODE_EDITOR_CHANGE_CREATEACTION:
      return {
        ...state,
        enableCreateAction: action.createActionEnable,
        sourceCode: action.sourceCode,
      };

    default:
      return state;
  }
};

export default reducer;
