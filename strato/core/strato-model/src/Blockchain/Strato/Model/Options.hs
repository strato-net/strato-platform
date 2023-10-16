{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Model.Options where

import Blockchain.Strato.Model.Util
import Data.ByteString.Internal
import HFlags
import GHC.Natural (Natural, naturalFromInteger)

defineFlag "network" ("mercata" :: String) "Choose a network to join"
defineFlag "networkID" (-1 :: Integer) "set a custom network ID for the client"
defineFlag "testnet" False "connect to testnet"

computeNetworkID :: Natural
computeNetworkID =
  case (flags_network, flags_networkID) of
    ("", -1) ->
      if flags_testnet
        then 0
        else 1
    (network, -1) -> newtorkToID network
    (_, networkID) -> naturalFromInteger networkID -- providing a networkID will ignore network name
  where
    newtorkToID :: String -> Natural
    newtorkToID network = case network of
      "mercata-hydrogen" -> 7596898649924658542 -- mercata-hydrogen networkID was manually changed
      "mercata" -> 6909499098523985262
      n -> naturalFromInteger . bytes2Integer $ map c2w n
