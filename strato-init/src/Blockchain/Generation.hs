module Blockchain.Generation (
  insertContracts
) where

import Data.ByteString
import qualified Data.Aeson as Aeson

import Blockchain.Strato.Model.Address

insertContracts :: ByteString -> Address -> Integer -> Aeson.Value -> Aeson.Value
insertContracts _ _ _ = id
