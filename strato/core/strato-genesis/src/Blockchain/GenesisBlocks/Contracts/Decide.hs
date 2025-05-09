{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module Blockchain.GenesisBlocks.Contracts.Decide (
  insertDecideContract
  ) where

import Blockchain.Data.GenesisInfo
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Data.Text (Text)
import Data.Text.Encoding
import Text.RawString.QQ

-- | Inserts the 0xDEC1DE contract into the genesis block with the BlockApps root cert as owner
insertDecideContract :: GenesisInfo -> GenesisInfo
insertDecideContract gi =
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
        []

dec1deContract :: Text
dec1deContract =
  [r|
contract Decider {
    constructor() {
    }

    function decide() returns (bool) {
//      int oneDollar = 1e18;
//      address USDST = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
//      address validatorPool = address(0x1234);

//      USDST.call("transfer", validatorPool, 0.10 * oneDollar); //Each transaction costs 10¢

      require(1==1, "forbidden!");
      
      return true;
    }
}|]
