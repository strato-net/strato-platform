pragma solidvm 12.0;

import <BASE_CODE_COLLECTION>;

contract SimpleTokenFaucet is TokenFaucet {
    constructor(TokenFaucetInfo[] _tokens) TokenFaucet(_tokens) {
        
    }
}