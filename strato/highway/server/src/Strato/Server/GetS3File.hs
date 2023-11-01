{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Strato.Server.GetS3File
  ( getS3File
  )
where

import qualified Aws
import qualified Aws.S3 as S3
import           Data.ByteString.UTF8 as BLU
import           Control.Monad.Trans.Resource
import           Data.Conduit ((.|), runConduit)
import           Data.Conduit.Binary (sinkFile)
import           Network.HTTP.Conduit (newManager, tlsManagerSettings, responseBody)

import           BlockApps.Logging
import           Blockchain.Strato.Model.Keccak256
import           Strato.API


getS3File hash = do
  --Set up AWS credentials and the default configuration.
  cr <- liftIO $ makeCredentials (BLU.fromString "AKIAV5NMROVZIZQY4OAE")
                                 (BLU.fromString "4/AGZk38zd5kkHzsHmObyst8v+o2SjoESH8qAWQG")
  let s3cfg = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
  --Set up a ResourceT region with an available HTTP manager.
  mgr <- newManager tlsManagerSettings
  runResourceT $ do
    --Create a request object with S3.getObject and run the request with pureAws.
    S3.GetObjectResponse { S3.gorResponse = rsp } <-
      Aws.pureAws cfg s3cfg mgr $
        S3.getObject "mercata-testnet2" (show hash)
    --Save the response to a file.
    runConduit $ responseBody rsp .| sinkFile (show hash) 
