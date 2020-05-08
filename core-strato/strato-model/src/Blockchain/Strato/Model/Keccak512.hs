{-# LANGUAGE PackageImports #-}

module Blockchain.Strato.Model.Keccak512 where


import qualified    Crypto.Hash                          as Cr (Digest, hash, Keccak_512)
import qualified    Data.ByteString.Char8                as BC


import              Data.ByteArray                       (convert)

keccak512 :: BC.ByteString -> BC.ByteString
keccak512 bs = convert (Cr.hash bs :: Cr.Digest Cr.Keccak_512)


