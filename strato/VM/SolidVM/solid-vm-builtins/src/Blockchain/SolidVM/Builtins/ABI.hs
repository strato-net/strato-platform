module Blockchain.SolidVM.Builtins.ABI (module ABI, encodeArguments) where

import SolidVM.Model.ABI as ABI
import qualified Data.ByteString as B

encodeArguments :: Bool -> [(Bool, B.ByteString)] -> B.ByteString
encodeArguments packed fields = if packed then abiEncodePacked (map snd fields) else abiEncode fields
