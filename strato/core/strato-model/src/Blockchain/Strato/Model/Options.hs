{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Model.Options where

import Blockchain.Strato.Model.Util
import Data.ByteString.Internal
import HFlags

defineFlag "network" ("" :: String) "Choose a network to join"
defineFlag "networkID" (-1 :: Integer) "set a custom network ID for the client"
defineFlag "testnet" False "connect to testnet"

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
      n -> bytes2Integer $ map c2w n
