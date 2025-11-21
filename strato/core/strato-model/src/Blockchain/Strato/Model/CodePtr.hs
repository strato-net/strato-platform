{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Model.CodePtr
  ( CodePtr (..)
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Control.Lens ((&), (?~))
import qualified Data.Aeson as Ae
import qualified Data.Aeson.Types as Ae
import Data.Bifunctor (bimap)
import Data.Binary
import Data.Data
import Data.Hashable (Hashable)
import qualified Data.Swagger as S
import Data.Swagger.Internal.Schema (named)
import qualified Data.Text as T
import Database.Persist.Sql
import GHC.Generics
import Servant.API
import Test.QuickCheck
import Text.Format
import Text.Read (readEither)

data CodePtr
  = ExternallyOwned Keccak256
  | SolidVMCode String Keccak256
  deriving (Show, Read, Eq, Ord, Generic, NFData, Hashable, Data)

instance S.ToSchema CodePtr where
  declareNamedSchema _ = return $ named "Code Pointer" S.binarySchema

instance RLPSerializable CodePtr where
  rlpEncode (ExternallyOwned codeHash) = rlpEncode codeHash
  rlpEncode (SolidVMCode n ch) = RLPArray [RLPString "SolidVM", rlpEncode n, rlpEncode ch]

  rlpDecode (RLPArray [RLPString "SolidVM", n, ch]) = SolidVMCode (rlpDecode n) (rlpDecode ch)
  rlpDecode ch = ExternallyOwned $ rlpDecode ch

instance Binary CodePtr

{-
instance Show CodePtr where
  show (ExternallyOwned hsh) = "ExternallyOwned " ++ format hsh
  show (SolidVMCode name hsh) = "SolidVMCode " ++ name ++ " " ++ format hsh
-}

instance Ae.ToJSON CodePtr where
  toJSON (ExternallyOwned hsh) = Ae.object [("kind", Ae.toJSON $ T.pack "ExternallyOwned"), ("digest", Ae.toJSON hsh)]
  toJSON (SolidVMCode name hsh) =
    Ae.object
      [ ("kind", Ae.toJSON $ T.pack "SolidVM"),
        ("name", Ae.toJSON name),
        ("digest", Ae.toJSON hsh)
      ]

instance Ae.FromJSON CodePtr where
  parseJSON (st@Ae.String {}) = ExternallyOwned <$> Ae.parseJSON st
  parseJSON (Ae.Object o) = do
    kind :: Maybe T.Text <- o Ae..:? "kind"
    case kind of
      Just "ExternallyOwned" -> do
        hsh <- o Ae..: "digest"
        return $ ExternallyOwned hsh
      _ -> do
        hsh <- o Ae..: "digest"
        name <- o Ae..: "name"
        return $ SolidVMCode name hsh
  parseJSON x = Ae.typeMismatch "CodePtr" x

instance Arbitrary CodePtr where
  arbitrary = oneof [ExternallyOwned <$> arbitrary, SolidVMCode "Vehicle" <$> arbitrary]

instance PersistField CodePtr where
  toPersistValue cp@(ExternallyOwned _) = PersistText . T.pack $ show cp
  toPersistValue cp@(SolidVMCode _ _) = PersistText . T.pack $ show cp
  fromPersistValue (PersistText t) =
    let s = T.unpack t
        !cp = case readEither s of
                Right r -> Right r
                Left _ ->
                    bimap
                      T.pack
                      (ExternallyOwned . unsafeCreateKeccak256FromWord256)
                      $ readEither ("0x" ++ s) -- the node has been upgraded and contains legacy code hashes
     in cp
  fromPersistValue x = Left $ T.pack $ "PersistField CodePtr: expected text: " ++ (show x)

instance PersistFieldSql CodePtr where
  sqlType _ = SqlString

instance Format CodePtr where
  format (ExternallyOwned ch) = format ch
  format (SolidVMCode n ch) = "<SolidVMCode: " ++ n ++ ", " ++ format ch ++ ">"

instance ToHttpApiData CodePtr where
  toUrlPiece (ExternallyOwned hsh) = T.pack $ format hsh
  toUrlPiece (SolidVMCode name hsh) = T.pack $ name ++ ":" ++ format hsh

instance FromHttpApiData CodePtr where
  parseQueryParam x = case parseQueryParam x of
    Right hsh -> Right $ ExternallyOwned hsh
    _ -> case T.split (== ':') x of
           [name, hsh] -> SolidVMCode (T.unpack name) <$> parseQueryParam hsh
           _ -> Left $ "FromHttpApiData CodePtr: couldn't resolve CodePtr from " `T.append` x

instance S.ToParamSchema CodePtr where
  toParamSchema _ =
    mempty
      & S.type_ ?~ S.SwaggerString
      & S.format ?~ "hex string"
