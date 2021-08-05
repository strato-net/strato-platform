{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
module Blockchain.ExtendedECDSA.Model.ExtendedSignature where

import Data.Data
import GHC.Generics

import qualified Network.Haskoin.Internals as HK


-- deprecated. Use Blockchain.Strato.Model.Secp256k1


data ExtendedSignature = ExtendedSignature HK.Signature Bool deriving (Show, Eq, Generic, Data)
