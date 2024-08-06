{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module GitImage where

import Data.Aeson
import qualified Data.ByteString.Lazy.Char8 as BLC
import Data.Char
import GHC.Generics
import System.Process
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time.Clock
import Data.Time.Format

newtype GitTime = GitTime UTCTime deriving (Show, Eq, Ord, ParseTime)

instance FromJSON GitTime where
  parseJSON (String s) = parseTimeM False defaultTimeLocale "%Y-%m-%d %H:%M:%S %z %EZ" $ T.unpack s 

data GitImage = GitImage {
  containers :: Text,
  createdAt :: GitTime,
  createdSince :: Text,
  digest :: Text,
  iD :: Text,
  repository :: Text,
  sharedSize :: Text,
  size :: Text,
  tag :: Text,
  uniqueSize :: Text,
  virtualSize :: Text
  } deriving (Show, Generic)

formatImageName :: GitImage -> Text
formatImageName GitImage{..} = repository <> ":" <> tag

instance FromJSON GitImage where
  parseJSON = genericParseJSON defaultOptions{fieldLabelModifier=upFirst}

upFirst :: String -> String
upFirst "" = ""
upFirst (first:rest) = toUpper first:rest

getGitImages :: IO [GitImage]
getGitImages = do
  response <- readProcess "docker" ["images", "--format", "json"] ""

  let imagesOrError = sequence $ map (eitherDecode . BLC.pack) $ lines response :: (Either String [GitImage])

  case imagesOrError of
    Right images -> return images
    Left e -> error $ show e
