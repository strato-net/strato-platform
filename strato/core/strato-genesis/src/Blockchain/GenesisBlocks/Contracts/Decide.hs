{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module Blockchain.GenesisBlocks.Contracts.Decide
  ( insertDecideContract,
  )
where

import Blockchain.Data.GenesisInfo
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Data.Text (Text)
import Data.Text.Encoding
import Text.RawString.QQ

-- | Inserts the 0xDEC1DE and contract 0xDEC1DEFF into the genesis block with the BlockApps root cert as owner
insertDecideContract :: GenesisInfo -> GenesisInfo
insertDecideContract gi =
  gi
    { genesisInfoAccountInfo = genesisInfoAccountInfo gi ++ [decideAcct] ++ [decideStateAcct],
      genesisInfoCodeInfo = genesisInfoCodeInfo gi ++ [CodeInfo dec1deContract (Just "Decider")] ++ [CodeInfo dec1deStateContract (Just "DeciderState")]
    }
  where
    decideAcct =
      SolidVMContractWithStorage
        0xDEC1DE
        0
        (SolidVMCode "Decider" (KECCAK256.hash $ encodeUtf8 dec1deContract))
        []
    decideStateAcct =
      SolidVMContractWithStorage
        0xDEC1DEFF
        0
        (SolidVMCode "DeciderState" (KECCAK256.hash $ encodeUtf8 dec1deStateContract))
        []

dec1deContract :: Text
dec1deContract =
  [r|
interface GetImplContract {
    function getImplContract() public view returns (address);
}

contract record Decider {
    GetImplContract deciderStateContract = GetImplContract(address(0xDEC1DEFF));
    string functionName = "PayFees";
    constructor() {
    }

    function decide() returns (bool) {
        address payFeesImplContract = deciderStateContract.getImplContract();
        payFeesImplContract.delegatecall(functionName);
        return true;
    }
}|]

dec1deStateContract :: Text
dec1deStateContract =
  [r|
abstract contract ERC20_Template {
  function transfer(address _to, uint _amount) public;
}

interface PayFees {
    function payFees() external;
}

interface GetImplContract {
    function getImplContract() public view returns (address);
}

contract record DeciderState is PayFees, GetImplContract {
    address public owner;
    address public currentFeeContract = address(this);

    constructor(address _owner) {
        owner = _owner;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    function upateOwner(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Cannot set owner to zero address");
        require(_newOwner != owner, "Should set new owner as different from current owner");
        owner = _newOwner;
    }

    function getImplContract() public view override returns (address) {
        return currentFeeContract;
    }

    function updatePayFeeContract(PayFees _newFeeContract) external onlyOwner {
        require(address(_newFeeContract) != address(0), "Cannot set contract address to zero address");
        currentFeeContract = address(_newFeeContract);
    }

    function payFees() override external {
        uint oneDollar = 1e18;
        address USDST = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
        address validatorPool = address(0x1234);
        ERC20_Template(USDST).transfer(validatorPool, oneDollar / 10);
    }
}|]