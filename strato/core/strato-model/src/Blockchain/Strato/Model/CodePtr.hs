{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Model.CodePtr
  ( CodePtr (..),
    CodeKind (..),
  )
where

import Blockchain.Data.RLP
import Blockchain.SolidVM.Model (CodeKind (..))
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Control.Lens ((&), (?~))
import qualified Data.Aeson as Ae
import qualified Data.Aeson.Types as Ae
import Data.Bifunctor (bimap, first)
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
  | CodeAtAccount Account String
  deriving (Show, Read, Eq, Ord, Generic, NFData, Hashable, Data)

instance S.ToSchema CodePtr where
  declareNamedSchema _ = return $ named "Code Pointer" S.binarySchema

instance RLPSerializable CodePtr where
  rlpEncode (ExternallyOwned codeHash) = rlpEncode codeHash
  rlpEncode (SolidVMCode n ch) = RLPArray [RLPString "SolidVM", rlpEncode n, rlpEncode ch]
  rlpEncode (CodeAtAccount a n) = RLPArray [RLPString "AtAccount", rlpEncode a, rlpEncode n]

  rlpDecode (RLPArray [RLPString "SolidVM", n, ch]) = SolidVMCode (rlpDecode n) (rlpDecode ch)
  rlpDecode (RLPArray [RLPString "AtAccount", a, n]) = CodeAtAccount (rlpDecode a) (rlpDecode n)
  rlpDecode ch = ExternallyOwned $ rlpDecode ch

instance Binary CodePtr

{-
instance Show CodePtr where
  show (ExternallyOwned hsh) = "ExternallyOwned " ++ format hsh
  show (SolidVMCode name hsh) = "SolidVMCode " ++ name ++ " " ++ format hsh
-}

instance Ae.ToJSON CodePtr where
  toJSON (ExternallyOwned hsh) = Ae.object [("kind", Ae.toJSON EVM), ("digest", Ae.toJSON hsh)]
  toJSON (SolidVMCode name hsh) =
    Ae.object
      [ ("kind", Ae.toJSON SolidVM),
        ("name", Ae.toJSON name),
        ("digest", Ae.toJSON hsh)
      ]
  toJSON (CodeAtAccount acct name) =
    Ae.object
      [ ("account", Ae.toJSON acct),
        ("name", Ae.toJSON name)
      ]

instance Ae.FromJSON CodePtr where
  parseJSON (st@Ae.String {}) = ExternallyOwned <$> Ae.parseJSON st
  parseJSON (Ae.Object o) = do
    kind <- o Ae..:? "kind"
    case kind of
      Just EVM -> do
        hsh <- o Ae..: "digest"
        return $ ExternallyOwned hsh
      Just SolidVM -> do
        hsh <- o Ae..: "digest"
        name <- o Ae..: "name"
        return $ SolidVMCode name hsh
      Nothing -> do
        acct <- o Ae..: "account"
        name <- o Ae..: "name"
        return $ CodeAtAccount acct name
  parseJSON x = Ae.typeMismatch "CodePtr" x

instance Arbitrary CodePtr where
  arbitrary = oneof [ExternallyOwned <$> arbitrary, SolidVMCode "Vehicle" <$> arbitrary, flip CodeAtAccount "Vehicle" <$> arbitrary]

instance PersistField CodePtr where
  toPersistValue cp@(ExternallyOwned _) = PersistText . T.pack $ show cp
  toPersistValue cp@(SolidVMCode _ _) = PersistText . T.pack $ show cp
  toPersistValue (CodeAtAccount acct name) = PersistText . T.pack $ name ++ "@" ++ show acct
  fromPersistValue (PersistText t) =
    let s = T.unpack t
        !cp = case readEither s of
                Right r -> Right r
                Left _ -> case span (/= '@') s of
                  (name, '@' : acct) -> first T.pack $ flip CodeAtAccount name <$> readEither acct
                  (_, _) ->
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
  format (CodeAtAccount a n) = "<CodeAtAccount: " ++ format a ++ ", " ++ n ++ ">"

instance ToHttpApiData CodePtr where
  toUrlPiece (ExternallyOwned hsh) = T.pack $ format hsh
  toUrlPiece (SolidVMCode name hsh) = T.pack $ name ++ ":" ++ format hsh
  toUrlPiece (CodeAtAccount acct name) = T.pack $ name ++ "@" ++ show acct

instance FromHttpApiData CodePtr where
  parseQueryParam x = case parseQueryParam x of
    Right hsh -> Right $ ExternallyOwned hsh
    _ -> case T.split (== '@') x of
      [acct, name] -> flip CodeAtAccount (T.unpack name) <$> parseQueryParam acct
      _ -> case T.split (== ':') x of
        [name, hsh] -> SolidVMCode (T.unpack name) <$> parseQueryParam hsh
        _ -> Left $ "FromHttpApiData CodePtr: couldn't resolve CodePtr from " `T.append` x

instance S.ToParamSchema CodePtr where
  toParamSchema _ =
    mempty
      & S.type_ ?~ S.SwaggerString
      & S.format ?~ "hex string"
