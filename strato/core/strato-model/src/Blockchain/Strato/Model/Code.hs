{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Model.Code where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.CodePtr
import Control.DeepSeq
import Control.Lens.Operators
import Data.Aeson
import Data.Binary
import Data.Data
import Data.Swagger
import Data.Text (Text)
import Database.Persist.TH
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

data Code
  = Code {codeBytes :: Text}
  | PtrToCode {ptrToCode :: CodePtr}
  deriving (Show, Eq, Read, Ord, Generic, Data)

instance Binary Code

instance NFData Code

instance Arbitrary Code where
  arbitrary = Code <$> arbitrary

derivePersistField "Code"

instance RLPSerializable Code where
  rlpEncode (Code bytes) = rlpEncode bytes
  rlpEncode (PtrToCode codePtr) = RLPArray [rlpEncode codePtr]
  rlpDecode (RLPArray [x]) = PtrToCode $ rlpDecode x
  rlpDecode x = Code $ rlpDecode x

instance ToSchema Code where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Code")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ toJSON (Code "contract test{}")
            & description ?~ "Code Bytestring"
        )

instance ToJSON Code where
  toJSON (Code theText) = String theText
  toJSON (PtrToCode codePtr) = toJSON codePtr

instance FromJSON Code where
  parseJSON (String text) = return $ Code text
  parseJSON x = PtrToCode <$> parseJSON x

data PrecompiledCode
  = NullContract
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
