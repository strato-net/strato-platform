{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Strato.Server.GetS3File
  ( getS3File
  )
where

import qualified Aws
import qualified Aws.S3 as S3
import           Conduit

import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Data.ByteString.Lazy as DBL
import           Data.ByteString.Char8 as DBC8
import           Data.Either (fromRight)
import           Data.Proxy
import           Data.Text as T
import           Data.Text.Encoding (decodeUtf8)
import           Network.HTTP.Conduit (responseBody)
import           Servant.API.ContentTypes

--import           BlockApps.Logging
import           Strato.API
import           Strato.Monad
import           Blockchain.Strato.Model.Keccak256


getS3File :: Keccak256
          -> HighwayM ContentTypeAndBody
getS3File keccakhash = do
  --Set up AWS credentials and the default configuration.
  $logInfoS "highway/getS3File" $ T.pack $ "Setting up AWS credentials and the default AWS configuration."
  mgr     <- asks httpManager
  awsakid <- asks awsaccesskeyid
  awssak  <- asks awssecretaccesskey
  awss3b  <- asks awss3bucket
  cr      <- liftIO $ Aws.makeCredentials awsakid
                                          awssak
  let cfg = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                              , Aws.credentials = cr
                              , Aws.logger      = Aws.defaultLog Aws.Warning
                              , Aws.proxy       = Nothing
                              }
  let s3cfg = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
  --Set up a ResourceT region with an available HTTP manager.
  $logInfoS "highway/getS3File" $ T.pack $ "Setting up a ResourceT region with an available HTTP manager."
  st      <- askUnliftIO
  liftIO $ runResourceT $ do
    --Create a request object with S3.getObject and run the request with pureAws.
    liftIO $ unliftIO st $ $logInfoS "highway/getS3File" $ T.pack $ "Creating a request object with getObject and running the request via pureAws."
    S3.GetObjectResponse { S3.gorResponse = rsp } <-
      Aws.pureAws cfg s3cfg mgr $
        S3.getObject awss3b (decodeUtf8 $ keccak256ToByteString keccakhash)
    --Save the response to a file.
    liftIO $ unliftIO st $ $logInfoS "highway/getS3File" $ T.pack $ "Saving the response (file contents) to a file."
    filecontents <- runConduit $ responseBody rsp .| sinkList -- $ DBLC8.unpack $ DBL.fromStrict $ keccak256ToByteString keccakhash
    let filecontentsf = fromRight (ContentTypeAndBody { contentTypeHeader = DBL.empty
                                                      , contentTypeBody   = DBL.empty
                                                      }
                                  ) 
                                  (mimeUnrender (Proxy @Web) (DBC8.fromStrict $ DBC8.concat filecontents))
    return filecontentsf
