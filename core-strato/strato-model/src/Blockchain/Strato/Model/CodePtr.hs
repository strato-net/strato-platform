{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Model.CodePtr
  ( CodePtr(..)
  , CodeKind(..)
  ) where

import              Control.DeepSeq
import              Control.Lens                         ((?~), (&))
import qualified    Data.Aeson                           as Ae
import qualified    Data.Aeson.Types                     as Ae
import              Data.Binary
import              Data.Data
import              Data.DeriveTH
import              Data.Hashable                        (Hashable)
import qualified    Data.Swagger                         as S 
import              Data.Swagger.Internal.Schema (named)
import qualified    Data.Text                            as T
import              Database.Persist.TH
import              GHC.Generics
import              Servant.API
import              Test.QuickCheck
import              Text.Format

import              Blockchain.Data.RLP
import              Blockchain.SolidVM.Model             (CodeKind(..))
import              Blockchain.Strato.Model.Account
import              Blockchain.Strato.Model.Keccak256


data CodePtr = EVMCode Keccak256
             | SolidVMCode String Keccak256
             | CodeAtAccount Account String
             deriving (Show, Read, Eq, Ord, Generic, NFData, Hashable, Data)


  
instance S.ToSchema CodePtr where
  declareNamedSchema _ = return $ named "Code Pointer"  S.binarySchema


instance RLPSerializable CodePtr where
  rlpEncode (EVMCode codeHash) = rlpEncode codeHash
  rlpEncode (SolidVMCode n ch) = RLPArray [RLPString "SolidVM", rlpEncode n, rlpEncode ch]
  rlpEncode (CodeAtAccount a n) = RLPArray [RLPString "AtAccount", rlpEncode a, rlpEncode n]

  rlpDecode (RLPArray [RLPString "SolidVM", n, ch]) = SolidVMCode (rlpDecode n) (rlpDecode ch)
  rlpDecode (RLPArray [RLPString "AtAccount", a, n]) = CodeAtAccount (rlpDecode a) (rlpDecode n)
  rlpDecode ch = EVMCode $ rlpDecode ch

instance Binary CodePtr

{-
instance Show CodePtr where
  show (EVMCode hsh) = "EVMCode " ++ format hsh
  show (SolidVMCode name hsh) = "SolidVMCode " ++ name ++ " " ++ format hsh
-}

instance Ae.ToJSON CodePtr where
  toJSON (EVMCode hsh) = Ae.object [("kind", Ae.toJSON EVM), ("digest", Ae.toJSON hsh)]
  toJSON (SolidVMCode name hsh) = Ae.object [ ("kind", Ae.toJSON SolidVM)
                                            , ("name", Ae.toJSON name)
                                            , ("digest", Ae.toJSON hsh)
                                            ]
  toJSON (CodeAtAccount acct name) = Ae.object [ ("account", Ae.toJSON acct)
                                               , ("name", Ae.toJSON name)
                                               ]

instance Ae.FromJSON CodePtr where
  parseJSON (st@Ae.String{}) = EVMCode <$> Ae.parseJSON st
  parseJSON (Ae.Object o) = do
    kind <- o Ae..:? "kind"
    case kind of
      Just EVM -> do
        hsh <- o Ae..: "digest"
        return $ EVMCode hsh
      Just SolidVM -> do
        hsh <- o Ae..: "digest"
        name <- o Ae..: "name"
        return $ SolidVMCode name hsh
      Nothing -> do
        acct <- o Ae..: "account"
        name <- o Ae..: "name"
        return $ CodeAtAccount acct name
  parseJSON x = Ae.typeMismatch "CodePtr" x

derive makeArbitrary ''CodePtr

derivePersistField "CodePtr"

instance Format CodePtr where
  format (EVMCode ch) = format ch
  format (SolidVMCode n ch) = "<SolidVMCode: " ++ n ++ ", " ++ format ch ++ ">"
  format (CodeAtAccount a n) = "<CodeAtAccount: " ++ format a ++ ", " ++ n ++ ">"

instance ToHttpApiData CodePtr where
  toUrlPiece (EVMCode hsh) = T.pack $ format hsh
  toUrlPiece (SolidVMCode name hsh) = T.pack $ name ++ ":" ++ format hsh
  toUrlPiece (CodeAtAccount acct name) = T.pack $ name ++ "@" ++ show acct

instance FromHttpApiData CodePtr where
  parseQueryParam x = case parseQueryParam x of
    Right hsh -> Right $ EVMCode hsh
    _ -> case T.split (=='@') x of
           [acct, name] -> flip CodeAtAccount (T.unpack name) <$> parseQueryParam acct
           _ -> case T.split (==':') x of
             [name, hsh] -> SolidVMCode (T.unpack name) <$> parseQueryParam hsh
             _ -> fail $ "FromHttpApiData CodePtr: couldn't resolve CodePtr from " ++ T.unpack x

instance S.ToParamSchema CodePtr where
  toParamSchema _ = mempty
    & S.type_ ?~ S.SwaggerString
    & S.format ?~ "hex string"