
module Blockchain.SolidVM
    ( 
      call
    , create
    ) where

import qualified Data.ByteString                    as B
import qualified Data.Map.Strict                    as M
import qualified Data.Set                           as S
import qualified Data.Text                          as T

import           Blockchain.Data.Address
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Code
import           Blockchain.Data.ExecResults
import           Blockchain.ExtWord
import           Blockchain.SHA
import           Blockchain.Strato.Model.Gas
import           Blockchain.VMContext

create :: Bool
       -> Bool
       -> S.Set Address
       -> BlockData
       -> Int
       -> Address
       -> Address
       -> Integer
       -> Integer
       -> Gas
       -> Address
       -> Code
       -> SHA
       -> Maybe Word256
       -> Maybe (M.Map T.Text T.Text)
       -> ContextM ExecResults
--create isRunningTests' isHomestead preExistingSuicideList b callDepth sender origin
--       value gasPrice availableGas newAddress initCode txHash chainId metadata = 
create _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ =
  error "SolidVM create not yet implemented"
                                                                                 
call :: Bool
     -> Bool
     -> Bool
     -> S.Set Address
     -> BlockData
     -> Int
     -> Address
     -> Address
     -> Address
     -> Word256
     -> Word256
     -> B.ByteString
     -> Gas
     -> Address
     -> SHA
     -> Maybe Word256
     -> Maybe (M.Map T.Text T.Text)
     -> ContextM ExecResults
--call isRunningTests' isHomestead noValueTransfer preExistingSuicideList b callDepth receiveAddress
--     (Address codeAddress) sender value gasPrice theData availableGas origin txHash chainId metadata = 

call _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ =
  error "SolidVM call not yet implemented"



