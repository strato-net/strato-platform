{-# LANGUAGE PackageImports #-}

module Blockchain.Strato.Model.Keccak512 where

import qualified Crypto.Hash as Cr (Digest, Keccak_512, hash)
import Data.ByteArray (convert)
import qualified Data.ByteString.Char8 as BC

keccak512 :: BC.ByteString -> BC.ByteString
keccak512 bs = convert (Cr.hash bs :: Cr.Digest Cr.Keccak_512)
