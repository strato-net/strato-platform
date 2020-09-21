{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Strato.Model.Code where

import           Control.DeepSeq
import           Data.Binary
import qualified Data.ByteString     as B
import qualified Data.ByteString.Base16     as B16
import           Data.Data
import           Data.DeriveTH
import qualified Data.Text as T
import           Data.Text.Encoding  (encodeUtf8, decodeUtf8)
import           Database.Persist.TH
import           GHC.Generics
import           Data.Aeson

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.CodePtr
import           Test.QuickCheck
import           Test.QuickCheck.Instances()

data Code = Code { codeBytes :: B.ByteString }
          | PtrToCode { ptrToCode :: CodePtr } 
  deriving (Show, Eq, Read, Ord, Generic, Data)

instance Binary Code where
instance NFData Code

derive makeArbitrary ''Code

derivePersistField "Code"

instance RLPSerializable Code where
    rlpEncode (Code bytes) = rlpEncode bytes
    rlpEncode (PtrToCode codePtr) = RLPArray [rlpEncode codePtr]
    rlpDecode (RLPArray [x]) = PtrToCode $ rlpDecode x
    rlpDecode x = Code $ rlpDecode x

instance ToJSON Code where
  toJSON (Code bytes) = String . decodeUtf8 . B16.encode $ bytes
  toJSON (PtrToCode codePtr) = toJSON codePtr

instance FromJSON Code where
  parseJSON (String text) = return . Code . fst . B16.decode . encodeUtf8 . drop0x $ text
    where drop0x :: T.Text -> T.Text
          drop0x t = if "0x" `T.isPrefixOf` t
                       then T.drop 2 t
                       else t
  parseJSON x = PtrToCode <$> parseJSON x

data PrecompiledCode = NullContract
                     | ECRecover
                     | SHA256
                     | RIPEMD160
                     | IdentityContract
          deriving (Show, Eq, Enum, Bounded, Read, Ord, Generic, Data)

precompiledCodeNumber :: PrecompiledCode -> Int
precompiledCodeNumber = fromEnum

getPrecompiledCode_unsafe :: Int -> PrecompiledCode
getPrecompiledCode_unsafe = toEnum

getPrecompiledCode :: Int -> Maybe PrecompiledCode
getPrecompiledCode n =
  if (n >= precompiledCodeNumber minBound) && (n <= precompiledCodeNumber maxBound)
    then Just $ getPrecompiledCode_unsafe n
    else Nothing
