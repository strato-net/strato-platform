{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module Blockchain.GenesisBlocks.Contracts.Decide (
  insertDecideContract
  ) where

import Blockchain.Data.GenesisInfo
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Data.Text (Text)
import Data.Text.Encoding
import SolidVM.Model.Storable
import Text.RawString.QQ

-- | Inserts the 0xDEC1DE contract into the genesis block with the BlockApps root cert as owner
insertDecideContract :: Address -> GenesisInfo -> GenesisInfo
insertDecideContract usdstAddress gi =
  gi
    { genesisInfoAccountInfo = genesisInfoAccountInfo gi ++ [decideAcct],
      genesisInfoCodeInfo = genesisInfoCodeInfo gi ++ [CodeInfo dec1deContract (Just "Decider")]
    }
  where
    decideAcct =
      SolidVMContractWithStorage
        0xDEC1DE
        0
        (SolidVMCode "Decider" (KECCAK256.hash $ encodeUtf8 dec1deContract))
        [ (".USDST", BAccount $ unspecifiedChain usdstAddress)
        , (".validatorPool", BAccount $ unspecifiedChain 0x1234)
        ]

dec1deContract :: Text
dec1deContract =
  [r|
abstract contract ERC20_Template {
  function transfer(address _to, uint _amount) public;
}

contract record Decider {
    address public USDST;
    address public validatorPool;

    constructor() {
      USDST = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
      validatorPool = address(0x1234);
    }

    function decide() returns (bool) {
      uint oneDollar = 1e18;

      if (USDST != address(0)) {
          ERC20_Template(USDST).transfer(validatorPool, oneDollar / 10); //Each transaction costs 10¢
      }

      return true;
    }
}|]
