{- |
- Module: Blockchain.PrivateKeyConf
- Maintainer: Ryan Reich <ryan@blockapps.net>
- Description: The data type representing the node-wide p2p private key.
-
- We use a single globally configured private key that is shared among all
- p2p-related libraries (currently ethereum-discovery, strato-p2p-client,
- and strato-p2p-server).  This replaces a broken older system where each
- one chose its own key, introducing an identification error in
- communications when different components would represent the entire node
- to a peer at different times.
-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
module Blockchain.PrivateKeyConf where

import           Blockchain.ECIES
import           Crypto.PubKey.ECC.DH
import           Crypto.Random
import           Data.Bifunctor
import           Data.Yaml
import           GHC.Generics
import           Numeric

newtype PrivKey = PrivKey { unPrivKey :: PrivateNumber } deriving (Eq, Generic)

instance Read PrivKey where
  readsPrec _ s = map (first PrivKey) $ readHex s

instance Show PrivKey where
  show = flip showHex "" . unPrivKey

instance ToJSON PrivKey where
  toJSON = toJSON . show

instance FromJSON PrivKey where
  parseJSON v = read <$> parseJSON v

generatePrivKey :: IO PrivKey
generatePrivKey = do
  entropyPool <- createEntropyPool
  let g = cprgCreate entropyPool :: SystemRNG
  return $ PrivKey $ fst $ generatePrivate g theCurve

