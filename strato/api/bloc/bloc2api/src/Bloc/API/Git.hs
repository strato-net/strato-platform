{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Bloc.API.Git where

import Data.Aeson
import Data.ByteString.Char8 (pack, unpack)
import Data.ByteString.Lazy (fromStrict, toStrict)
import Data.Proxy
import Data.Swagger
import Development.GitRev
import GHC.Generics
import Servant.API
import Servant.Docs
import Test.QuickCheck

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetGitInfo = Get '[JSON, PlainText] GitInfo

gitInfo :: GitInfo
gitInfo =
  GitInfo
    { gitInfoHash = $(gitHash),
      gitInfoBranch = $(gitBranch),
      gitInfoCommitCount = $(gitCommitCount),
      gitInfoCommitDate = $(gitCommitDate),
      gitInfoDescribe = $(gitDescribe),
      gitInfoDirty = $(gitDirty),
      gitInfoDirtyTracked = $(gitDirtyTracked)
    }

data GitInfo = GitInfo
  { gitInfoHash :: String,
    gitInfoBranch :: String,
    gitInfoCommitCount :: String,
    gitInfoCommitDate :: String,
    gitInfoDescribe :: String,
    gitInfoDirty :: Bool,
    gitInfoDirtyTracked :: Bool
  }
  deriving (Show, Generic, Ord, Read, Eq)

instance ToJSON GitInfo

instance FromJSON GitInfo

instance ToSample GitInfo where toSamples _ = singleSample gitInfo

instance Arbitrary GitInfo where arbitrary = return gitInfo

instance ToSchema GitInfo

instance MimeRender PlainText GitInfo where
  mimeRender Proxy = fromStrict . pack . show

instance MimeUnrender PlainText GitInfo where
  mimeUnrender Proxy = read . unpack . toStrict
