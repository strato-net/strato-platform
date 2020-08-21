{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Common.Message where

import           Blockchain.Data.ExecResults
import qualified Blockchain.Database.MerklePatricia as MP
import           Data.Aeson (ToJSON, FromJSON, toEncoding, parseJSON,
                            defaultOptions, Options,
                            genericToEncoding, genericParseJSON)
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import           GHC.Generics (Generic)
import           Text.Parsec
import           Text.Parsec.Error

data Ann = Ann
  { annRow :: Int
  , annCol :: Int 
  , annMsg :: T.Text
  , annErr :: Bool
  } deriving (Eq, Show, Generic)

toAnn :: ParseError -> [Ann]
toAnn pe =
  let sp = errorPos pe
      ms = errorMessages pe
      sl = sourceLine sp - 1
      sc = sourceColumn sp
   in map (\m -> Ann sl sc (T.pack $ messageString m) True) ms

data SolidVMCreateArgs = CreateArgs
  { createName :: T.Text
  , createArgs :: T.Text
  , createCode :: T.Text
  } deriving (Eq, Show, Generic)

data SolidVMCallArgs = CallArgs
  { callName :: T.Text
  , callArgs :: T.Text
  } deriving (Eq, Show, Generic)

data C2S = C2Scompile T.Text
         | C2Screate SolidVMCreateArgs
         | C2Scall SolidVMCallArgs
         | C2SgetMP
         deriving (Eq,Show, Generic)

options :: Options
options = defaultOptions -- { tagSingleConstructors = True }

data S2C = S2CcompileResult (Either [Ann] T.Text)
         | S2CcreateResult (Either T.Text ExecResults)
         | S2CcallResult (Either T.Text ExecResults)
         | S2CMP MP.StateRoot (M.Map MP.StateRoot MP.NodeData)
         deriving (Eq,Show, Generic)

instance ToJSON Ann where toEncoding = genericToEncoding options
instance FromJSON Ann where parseJSON = genericParseJSON options

instance ToJSON SolidVMCreateArgs where toEncoding = genericToEncoding options
instance FromJSON SolidVMCreateArgs where parseJSON = genericParseJSON options

instance ToJSON SolidVMCallArgs where toEncoding = genericToEncoding options
instance FromJSON SolidVMCallArgs where parseJSON = genericParseJSON options

instance ToJSON C2S where toEncoding = genericToEncoding options
instance FromJSON C2S where parseJSON = genericParseJSON options

instance ToJSON S2C where toEncoding = genericToEncoding options
instance FromJSON S2C where parseJSON = genericParseJSON options