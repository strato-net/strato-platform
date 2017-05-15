{-# LANGUAGE DataKinds       #-}
{-# LANGUAGE DeriveGeneric   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators   #-}

module BlockApps.Bloc21.API.Git where

import           Data.Aeson
import           Data.Swagger
import           Development.GitRev
import           GHC.Generics
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type GetGitInfo = "git" :> Get '[JSON] GitInfo

gitInfo :: GitInfo
gitInfo = GitInfo
  { gitInfoHash = $(gitHash)
  , gitInfoBranch = $(gitBranch)
  , gitInfoCommitCount = $(gitCommitCount)
  , gitInfoCommitDate = $(gitCommitDate)
  , gitInfoDescribe = $(gitDescribe)
  , gitInfoDirty = $(gitDirty)
  , gitInfoDirtyTracked = $(gitDirtyTracked)
  }

data GitInfo = GitInfo
  { gitInfoHash :: String
  , gitInfoBranch :: String
  , gitInfoCommitCount :: String
  , gitInfoCommitDate :: String
  , gitInfoDescribe :: String
  , gitInfoDirty :: Bool
  , gitInfoDirtyTracked :: Bool
  } deriving (Show,Generic)
instance ToJSON GitInfo
instance FromJSON GitInfo
instance ToSample GitInfo where toSamples _ = singleSample gitInfo
instance Arbitrary GitInfo where arbitrary = return gitInfo
instance ToSchema GitInfo
