{-# LANGUAGE OverloadedStrings, TypeSynonymInstances, FlexibleInstances, FlexibleContexts #-}

module Blockchain.GenesisBlockSetup (
  genesisBlockSetup,
  retrieveRandomPrivKey
  ) where

import Control.Monad (forM,forM_)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Binary
import qualified Data.Aeson as J

import System.Directory
import System.Entropy

import Network.Haskoin.Crypto hiding (Address)

import Blockchain.Data.GenesisInfo
import Blockchain.Data.Address


bigBalance::Integer
bigBalance = 1809251394333065553493296640760748560207343510400633813116524750123642650624

genesisBlockSetup :: Int -> IO ()
genesisBlockSetup n = do
    pairs <- generateNPrivkeyAddressPairs n
    createDirectory "priv"
    setCurrentDirectory "priv"
    writePrvKeys pairs
    let pairs' = map (\(_,_,z) -> (z,bigBalance)) pairs
        genesis = defaultGenesisInfo { genesisInfoAccountInfo = pairs' } 

    B.writeFile "hackathonGenesis.json" $ BL.toStrict $ J.encode genesis
    return ()

generateNPrivkeyAddressPairs :: Int -> IO [(Int,PrvKey,Address)]
generateNPrivkeyAddressPairs n = forM [1..n] $ \index -> do
    newPrvKey <- withSource getEntropy genPrvKey
    return (index,newPrvKey, prvKey2Address newPrvKey)


writePrvKeys :: [(Int,PrvKey,Address)] -> IO ()
writePrvKeys list = forM_ list $ \(index,priv, _) -> do
    encodeFile ("priv_" ++ (show index)) (show priv)

readPrvKey :: FilePath -> IO PrvKey
readPrvKey path = do
    keyString <- decodeFile path :: IO String
    return . read $ keyString

retrieveRandomPrivKey :: Int -> IO PrvKey
retrieveRandomPrivKey n = readPrvKey $ "priv_" ++ (show n)

--writeGenesisBlock = undefined
