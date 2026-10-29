module Blockchain.SolidVM.Builtins.Encoding (b16encode, b16decode, normalizeHex, bytes32ToString) where

import Blockchain.VM.SolidException (invalidArguments)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import qualified Data.ByteString.Base16 as B16

b16encode :: B.ByteString -> B.ByteString
b16encode = B16.encode

b16decode :: B.ByteString -> B.ByteString
b16decode input =
  let padded = if odd (B.length input) then B.cons 48 input else input
   in case B16.decode padded of
        Right decoded -> decoded
        Left _ -> invalidArguments "b16decode: invalid hex string" input

normalizeHex :: String -> String
normalizeHex input =
  let hexPart = case input of
        '0' : 'x' : rest -> rest
        _ -> input
      encoded = DT.encodeUtf8 $ T.pack hexPart
      padded = if odd (B.length encoded) then B.cons 48 encoded else encoded
   in case B16.decode padded of
        Right decoded -> "0x" ++ BC.unpack (B16.encode decoded)
        Left _ -> invalidArguments "normalizeHex: invalid hex string" input

bytes32ToString :: String -> String
bytes32ToString = id
