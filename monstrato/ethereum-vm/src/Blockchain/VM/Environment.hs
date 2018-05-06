
module Blockchain.VM.Environment where

import qualified Data.ByteString            as B

import           Blockchain.Data.Address
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.ExtWord

data Environment =
    Environment {
      envOwner       :: Address,
      envOrigin      :: Address,
      envGasPrice    :: Integer,
      envInputData   :: B.ByteString,
      envSender      :: Address,
      envValue       :: Integer,
      envCode        :: Code,
      envJumpDests   :: [Word256],
      envBlockHeader :: BlockData,
      envChainId     :: Maybe Word256
    }

