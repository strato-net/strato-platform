import { contractCall } from "./contractCall";

const tokenContractName = 'Token';

class TokenContractCall {
  contractAddress: string;

  constructor(contractAddress: string) {
    this.contractAddress = contractAddress;
  }

  async balanceOf(args: any) {
    const tokenContract = await contractCall(tokenContractName, this.contractAddress, "balanceOf", args);
    return tokenContract.data.contents[0];
  }    
}

export default TokenContractCall;
