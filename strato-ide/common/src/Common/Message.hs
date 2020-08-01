{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Common.Message where

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

data C2S = C2Scompile (Int, T.Text)
         deriving (Eq,Show, Generic)

options :: Options
options = defaultOptions -- { tagSingleConstructors = True }

data S2C = S2Cannotations [Ann]
         deriving (Eq,Show, Generic)

instance ToJSON Ann where toEncoding = genericToEncoding options
instance FromJSON Ann where parseJSON = genericParseJSON options

instance ToJSON C2S where toEncoding = genericToEncoding options
instance FromJSON C2S where parseJSON = genericParseJSON options

instance ToJSON S2C where toEncoding = genericToEncoding options
instance FromJSON S2C where parseJSON = genericParseJSON options