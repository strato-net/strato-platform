{-# LANGUAGE TemplateHaskell #-}
module Main where

import HFlags
import qualified Data.Aeson                 as Ae
import qualified Data.ByteString.Char8      as C8
import           Data.ByteString.Base16              as B16
import           Data.Either.Extra
import           Data.Maybe
import qualified Network.Haskoin.Crypto     as HK
import           System.Environment

import           Blockchain.Blockstanbul.Authentication
import qualified Blockchain.Blockstanbul.HTTPAdmin as API
import           Blockchain.Data.Address
import           Blockchain.Data.RLP

defineFlag "node" ("" :: String) "Server with a running pbft node"
defineFlag "recipient" ("" :: String) "The recipient address of the validator-to-be-added or to-be-removed"
defineFlag "nonce" (0 :: Int) "Should be 0 for a first vote"
defineFlag "remove" (False :: Bool) "The voting direction"

main :: IO()
main = do
  s <- $initHFlags "blockstanbul-vote"
  putStrLn $ "Initiate a new round:" ++ show s
  pkey <- fromMaybe (error "PRIVATE KEY not set") <$> lookupEnv "PRIVATE_KEY"
  let recipient = Ae.eitherDecodeStrict (C8.pack flags_recipient) :: Either String Address 
      pk = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ C8.pack pkey
      recipAddr = fromRight (error "Invalid Address") recipient
      addr = prvKey2Address pk
  esign <- signBenfInfo pk (recipAddr, flags_remove)
  let esignStr = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign)
      vote = API.CandidateReceived{API.sender=addr
                                 , API.signature=esignStr
                                 , API.recipient=recipAddr
                                 , API.votingdir=flags_remove
                                 , API.nonce=flags_nonce}
  API.uploadVote 8050 flags_node vote

