{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Strato.Server.GetS3File
  ( getS3File
  )
where

import qualified Aws
import qualified Aws.S3 as S3
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import           Data.ByteString.Lazy as DBL
import           Data.ByteString.Lazy.Char8 as DBLC8
import           Data.ByteString.UTF8 as BLU
import           Data.Text as T
import           Data.Conduit ((.|), runConduit)
import           Data.Conduit.Binary (sinkFile)
import           Data.Text.Encoding (decodeUtf8)
import           Network.HTTP.Conduit (responseBody)

--import           BlockApps.Logging
import           Strato.Monad
import           Blockchain.Strato.Model.Keccak256


--getS3File :: ( MonadLogger (LoggingT m)
--             , MonadUnliftIO m
--             )
--          => Keccak256 -> HighwayM ()
--getS3File :: ( MonadUnliftIO m
--             ) => HighwayWrapperEnv -> Keccak256 -> HighwayM ()
--getS3File :: ( MonadLogger (LoggingT m)
--             , MonadReader HighwayWrapperEnv m
--             , MonadUnliftIO m
--             ) => Keccak256 -> HighwayM ()
getS3File :: Keccak256
          -> HighwayM ()
getS3File keccakhash = do
  --Set up AWS credentials and the default configuration.
  $logInfoS "highway/getS3File" $ T.pack $ "Setting up AWS credentials and the default AWS configuration."
  cr  <- liftIO $ Aws.makeCredentials (BLU.fromString "AKIAV5NMROVZIZQY4OAE")
                                      (BLU.fromString "4/AGZk38zd5kkHzsHmObyst8v+o2SjoESH8qAWQG")
  let cfg = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                              , Aws.credentials = cr
                              , Aws.logger      = Aws.defaultLog Aws.Warning
                              , Aws.proxy       = Nothing
                              }
  let s3cfg = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
  --Set up a ResourceT region with an available HTTP manager.
  $logInfoS "highway/getS3File" $ T.pack $ "Setting up a ResourceT region with an available HTTP manager."
  --mgr <- liftIO $ newManager tlsManagerSettings
  mgr <- asks httpManager
  st  <- askUnliftIO
  liftIO $ runResourceT $ do
    --Create a request object with S3.getObject and run the request with pureAws.
    liftIO $ unliftIO st $ $logInfoS "highway/gets3File" $ T.pack $ "Creating a request object with getObject and running the request via pureAws."
    S3.GetObjectResponse { S3.gorResponse = rsp } <-
      Aws.pureAws cfg s3cfg mgr $
        S3.getObject "mercata-testnet2" (decodeUtf8 $ keccak256ToByteString keccakhash)
    --Save the response to a file.
    liftIO $ unliftIO st $ $logInfoS "highway/gets3File" $ T.pack $ "Saving the response (file contents) to a file."
    runConduit $ responseBody rsp .| sinkFile (DBLC8.unpack $ DBL.fromStrict $ keccak256ToByteString keccakhash)
    return ()
