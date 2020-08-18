{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Common.Message where

import           Blockchain.Data.ExecResults
import           Data.Aeson (ToJSON, FromJSON, toEncoding, parseJSON,
                            defaultOptions, Options,
                            genericToEncoding, genericParseJSON)
import qualified Data.Text as T
import           GHC.Generics (Generic)

data Ann = Ann
  { annRow :: Int
  , annCol :: Int 
  , annMsg :: T.Text
  , annErr :: Bool
  } deriving (Eq, Show, Generic)

data SolidVMCreateArgs = CreateArgs
  { contractName :: T.Text
  , contractArgs :: T.Text
  , contractCode :: T.Text
  } deriving (Eq, Show, Generic)

data SolidVMCallArgs = CallArgs
  { funcName :: T.Text
  , funcArgs :: T.Text
  } deriving (Eq, Show, Generic)

data C2S = C2Scompile T.Text
         | C2Screate SolidVMCreateArgs
         | C2Scall SolidVMCallArgs
         deriving (Eq,Show, Generic)

options :: Options
options = defaultOptions -- { tagSingleConstructors = True }

data S2C = S2CcompileResult (Either [Ann] T.Text)
         | S2CcreateResult (Either T.Text ExecResults)
         | S2CcallResult (Either T.Text ExecResults)
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