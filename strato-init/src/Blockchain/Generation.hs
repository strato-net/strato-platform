{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Generation (
  insertContracts
) where

import Data.ByteString hiding (map, count)
import qualified Data.ByteString.Base16 as B16

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA
import Blockchain.Data.GenesisInfo

insertContracts :: ByteString -> Address -> Integer -> GenesisInfo -> GenesisInfo
insertContracts code start count gi =
  let initialAccounts = genesisInfoAccountInfo gi
      initialCode = genesisInfoCodeInfo gi
      (decoded, extra) = B16.decode code
      codeHash = if extra /= ""
                   then error "bytecode not encoded in base16"
                   -- else (ByteArray.convert $ hash decoded :: Digest Keccak_256) :: ByteString
                   else superProprietaryStratoSHAHash decoded
      rng = [toInteger start..(toInteger start) + count - 1]
      range = map fromInteger rng
  in gi {genesisInfoAccountInfo = initialAccounts ++ map (mkContract codeHash) range,
         genesisInfoCodeInfo = initialCode ++ [code]}

mkContract :: SHA -> Address -> AccountInfo
mkContract code addr = Contract addr 0 code
