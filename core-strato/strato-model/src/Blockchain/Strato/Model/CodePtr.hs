{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Model.CodePtr where

import              Control.DeepSeq
import qualified    Data.Aeson                           as Ae
import qualified    Data.Aeson.Types                     as Ae
import              Data.Binary
import              Data.Data
import              Data.DeriveTH
import              Data.Hashable                        (Hashable)
import qualified    Data.Swagger                         as S 
import              Data.Swagger.Internal.Schema (named)
import              Database.Persist.TH
import              GHC.Generics
import              Test.QuickCheck

import              Blockchain.Data.RLP
import              Blockchain.SolidVM.Model             (CodeKind(..))
import              Blockchain.Strato.Model.SHA
import              Text.Format


data CodePtr = EVMCode SHA | SolidVMCode String SHA
             deriving (Show, Read, Eq, Ord, Generic, NFData, Hashable, Data)


  
instance S.ToSchema CodePtr where
  declareNamedSchema _ = return $ named "Code Pointer"  S.binarySchema


instance RLPSerializable CodePtr where
  rlpEncode (EVMCode codeHash) = rlpEncode codeHash
  rlpEncode (SolidVMCode n ch) = RLPArray [RLPString "SolidVM", rlpEncode n, rlpEncode ch]

  rlpDecode (RLPArray [RLPString "SolidVM", n, ch]) = SolidVMCode (rlpDecode n) (rlpDecode ch)
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

instance Ae.FromJSON CodePtr where
  parseJSON (st@Ae.String{}) = EVMCode <$> Ae.parseJSON st
  parseJSON (Ae.Object o) = do
    kind <- o Ae..: "kind"
    hsh <- o Ae..: "digest"
    case kind of
      EVM -> return $ EVMCode hsh
      SolidVM -> do
        name <- o Ae..: "name"
        return $ SolidVMCode name hsh
  parseJSON x = Ae.typeMismatch "CodePtr" x

derive makeArbitrary ''CodePtr

derivePersistField "CodePtr"

instance Format CodePtr where
  format (EVMCode ch) = format ch
  format (SolidVMCode n ch) = "<" ++ n ++ ", " ++ format ch ++ ">"

codePtrToSHA :: CodePtr -> SHA
codePtrToSHA (EVMCode hsh) = hsh
codePtrToSHA (SolidVMCode _ hsh) = hsh

