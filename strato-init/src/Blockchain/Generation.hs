{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Generation (
  insertContracts
) where

import Data.ByteString hiding (map, count)
import qualified Data.ByteString.Base16 as B16

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA
import Blockchain.Data.GenesisInfo

insertContracts :: String -> ByteString -> Address -> Integer -> GenesisInfo -> GenesisInfo
insertContracts src code start count gi =
  let initialAccounts = genesisInfoAccountInfo gi
      initialCode = genesisInfoCodeInfo gi
      (decoded, extra) = B16.decode code
      codeHash = if extra /= "" && extra /= "\n"
                   then error ("bytecode not encoded in base16:" ++ show code)
                   else superProprietaryStratoSHAHash decoded
      rng = [toInteger start..(toInteger start) + count - 1]
      mkContract addr = Contract addr 0 codeHash
      range = map fromInteger rng
  in gi {genesisInfoAccountInfo = initialAccounts ++ map mkContract range,
         genesisInfoCodeInfo = initialCode ++ [CodeInfo decoded src]}
