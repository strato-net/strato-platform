{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Model.Options where

import Blockchain.Strato.Model.Util
import Data.ByteString.Internal
import HFlags

defineFlag "network" ("mercata" :: String) "Choose a network to join"
defineFlag "networkID" (-1 :: Integer) "set a custom network ID for the client"
defineFlag "testnet" False "connect to testnet"
defineFlag "txSizeLimit" (150000 :: Int) "The maximum length of a valid RLP encoded transaction bytestring"
defineFlag "accountNonceLimit" (4000 :: Integer) "The maximum number of transactions an account can make"
defineFlag "gasLimit" (1000000 :: Integer) "The maximum amount of gas a transaction can use"

computeNetworkID :: Integer
computeNetworkID =
  case (flags_network, flags_networkID) of
    ("", -1) ->
      if flags_testnet
        then 0
        else 1
    (network, -1) -> newtorkToID network
    (_, networkID) -> networkID -- providing a networkID will ignore network name
  where
    newtorkToID :: String -> Integer
    newtorkToID network = case network of
      "mercata-hydrogen" -> 7596898649924658542 -- mercata-hydrogen networkID was manually changed
      "mercata" -> 6909499098523985262
      n -> bytes2Integer $ map c2w n
