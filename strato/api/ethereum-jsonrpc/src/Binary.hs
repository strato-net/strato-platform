{-# LANGUAGE OverloadedStrings #-}

module Binary
  ( strToAddress,
    strToByteString,
  )
where

import Blockchain.Strato.Model.Address
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL

strToAddress :: String -> Either String Address
strToAddress ('0' : 'x' : val) =
  case (odd $ length val, B16.decode $ BC.pack val) of
    (True, _) -> Left "hex string has odd length"
    (False, Right b) ->
      case decodeOrFail $ BL.fromStrict b of
        Left (_, _, e) -> Left e
        Right ("", _, address) -> Right address
        Right _ -> error "partial function"
    _ -> Left "invalid hex"
strToAddress _ = Left "missing 0x prefix for hex data"

strToByteString :: String -> Either String B.ByteString
strToByteString ('0' : 'x' : val) =
  case (odd $ length val, B16.decode $ BC.pack val) of
    (True, _) -> Left "hex string has odd length"
    (False, Right b) -> Right b
    _ -> Left "invalid hex"
strToByteString _ = Left "missing 0x prefix for hex data"
