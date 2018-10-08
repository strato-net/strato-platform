{-# LANGUAGE TemplateHaskell #-}
module Main where

import HFlags
import qualified Data.ByteString.Char8      as C8
import           Data.ByteString.Base16              as B16
import           Data.Maybe
import qualified Network.Haskoin.Crypto     as HK
import           System.Environment

import           Blockchain.Blockstanbul.Authentication
import qualified Blockchain.Blockstanbul.HTTPAdmin as API
import           Blockchain.Strato.Model.Address
import           Blockchain.Data.RLP

defineFlag "node" ("" :: String) "Server with a running pbft node"
defineFlag "recipient" ("" :: String) "The recipient address of the validator-to-be-added or to-be-removed"
defineFlag "nonce" (0 :: Int) "Should be 0 for a first vote. Each nonce from the same sender should be higher than previous nonce"
defineFlag "remove" (False :: Bool) "The voting direction"

$(return [])

main :: IO()
main = do
  _ <- $initHFlags "blockstanbul-vote"
  pkey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
  let eRecipient = stringAddress flags_recipient
      pk = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ C8.pack pkey
      recipient = fromMaybe (error "Invalid Address") eRecipient
      sender = prvKey2Address pk
  esign <- signBenfInfo pk (recipient, flags_remove)
  let esignStr = (C8.unpack . B16.encode) $ rlpSerialize (rlpEncode esign)
      vote = API.CandidateReceived{API.sender=sender
                                 , API.signature=esignStr
                                 , API.recipient=recipient
                                 , API.votingdir=flags_remove
                                 , API.nonce=flags_nonce}
  API.uploadVote 80 flags_node vote
