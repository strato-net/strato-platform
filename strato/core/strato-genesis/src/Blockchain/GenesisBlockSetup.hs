{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.GenesisBlockSetup
  ( genesisBlockSetup,
    retrieveRandomPrivKey,
  )
where

import Blockchain.Data.ChainInfo
import Blockchain.Data.GenesisInfo
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Control.Monad (forM, forM_)
import qualified Data.Aeson as J
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import System.Directory

bigBalance :: Integer
bigBalance = 1809251394333065553493296640760748560207343510400633813116524750123642650624

genesisBlockSetup :: Int -> IO ()
genesisBlockSetup n = do
  pairs <- generateNPrivkeyAddressPairs n
  createDirectory "priv"
  setCurrentDirectory "priv"
  writePrvKeys pairs
  let pairs' = map (\(_, _, z) -> NonContract z bigBalance) pairs
      genesis = defaultGenesisInfo {genesisInfoAccountInfo = pairs'}

  B.writeFile "hackathonGenesis.json" $ BL.toStrict $ J.encode genesis
  return ()

generateNPrivkeyAddressPairs :: Int -> IO [(Int, PrivateKey, Address)]
generateNPrivkeyAddressPairs n = forM [1 .. n] $ \index -> do
  newPrvKey <- newPrivateKey
  return (index, newPrvKey, fromPrivateKey newPrvKey)

writePrvKeys :: [(Int, PrivateKey, Address)] -> IO ()
writePrvKeys list = forM_ list $ \(index, priv, _) -> do
  encodeFile ("priv_" ++ (show index)) (show priv)

readPrvKey :: FilePath -> IO PrivateKey
readPrvKey path = do
  keyString <- decodeFile path :: IO String
  case importPrivateKey $ BC.pack keyString of
    Nothing -> error $ "unable to read private key in file \"" ++ path ++ "\""
    Just v -> return v

retrieveRandomPrivKey :: Int -> IO PrivateKey
retrieveRandomPrivKey n = readPrvKey $ "priv_" ++ (show n)
