{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Server where

import Data.Proxy
import Servant
import API
import Strato.Monad
import Strato.Server.GetS3File
import Strato.Server.Ping
import Strato.Server.PutS3File

highwayWrapper :: ServerT HighwayWrapperAPI HighwayM
highwayWrapper =
  getS3File
    :<|> getS3FileTesting
    :<|> putS3File
    :<|> ping

serveHighwayWrapper :: HighwayWrapperEnv -> Server HighwayWrapperAPI
serveHighwayWrapper env = hoistServer serverProxy (enterHighwayWrapper env) highwayWrapper

serverProxy :: Proxy HighwayWrapperAPI
serverProxy = Proxy
