{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Strato.Server.GetS3File
  ( getS3File
  , getS3FileTesting
  )
where

import qualified Aws
import qualified Aws.S3 as S3
import           Conduit

import           Control.Monad.IO.Unlift
import           Control.Monad.Reader
import           Data.ByteString.Lazy as DBL
import           Data.ByteString.Char8 as DBC8
import           Data.Text as T
import           Network.HTTP.Conduit (Response(..),responseBody)
import           Network.HTTP.Types.Status (Status(..))
import           System.FilePath (takeExtension)

import           BlockApps.Logging
import           Strato.API
import           Strato.Monad

getS3File :: Text
          -> HighwayM ContentTypeAndBody
getS3File filename = do
  --Set up AWS credentials and the default configuration.
  $logInfoS "highway/getS3File" $ T.pack $ "Setting up AWS credentials and the default AWS configuration."
  mgr    <- asks httpManager
  cr     <- asks awsCredentials
  awss3b <- asks awss3bucket
  let cfg = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                              , Aws.credentials = cr
                              , Aws.logger      = Aws.defaultLog Aws.Warning
                              , Aws.proxy       = Nothing
                              }
  let s3cfg = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
  --Set up a ResourceT region with an available HTTP manager.
  $logInfoS "highway/getS3File" $ T.pack $ "Setting up a ResourceT region with an available HTTP manager."
  st     <- askUnliftIO
  liftIO $ runResourceT $ do
    --Create a request object with S3.getObject and run the request with pureAws.
    liftIO $ unliftIO st $ $logInfoS "highway/getS3File" $ T.pack $ "Creating a request object with getObject and running the request via pureAws."
    S3.GetObjectResponse { S3.gorResponse = rsp } <-
      Aws.pureAws cfg s3cfg mgr $
        S3.getObject awss3b filename
    filecontents <- runConduit $ responseBody rsp .| sinkList -- $ DBLC8.unpack $ DBL.fromStrict $ keccak256ToByteString keccakhash
    let header = case takeExtension $ T.unpack filename of
          ".jpg" -> "image/jpg"
          ".jpeg" -> "image/jpeg"
          ".png" -> "image/png"
          ".gif" -> "image/gif"
          ".svg" -> "image/svg+xml"
          ".pdf" -> "application/pdf"
          ".html" -> "text/html"
          ".css" -> "text/css"
          ".js" -> "text/javascript"
          ".json" -> "application/json"
          ".webp" -> "image/webp"
          _ -> "text/plain"
    pure $ ContentTypeAndBody
             { contentTypeHeader = header
             , contentTypeBody   = DBL.fromStrict $ DBC8.concat filecontents
             }

getS3FileTesting :: Text
                 -> HighwayM (Status,ContentTypeAndBody)
getS3FileTesting filename = do
  --Set up AWS credentials and the default configuration.
  $logInfoS "highway/getS3FileTesting" $ T.pack $ "Setting up AWS credentials and the default AWS configuration."
  mgr    <- asks httpManager
  cr     <- asks awsCredentials
  awss3b <- asks awss3bucket
  let cfg = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                              , Aws.credentials = cr
                              , Aws.logger      = Aws.defaultLog Aws.Warning
                              , Aws.proxy       = Nothing
                              }
  let s3cfg = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
  --Set up a ResourceT region with an available HTTP manager.
  $logInfoS "highway/getS3FileTesting" $ T.pack $ "Setting up a ResourceT region with an available HTTP manager."
  st     <- askUnliftIO
  liftIO $ runResourceT $ do
    --Create a request object with S3.getObject and run the request with pureAws.
    liftIO $ unliftIO st $ $logInfoS "highway/getS3FileTesting" $ T.pack $ "Creating a request object with getObject and running the request via pureAws."
    S3.GetObjectResponse { S3.gorResponse = rsp } <-
      Aws.pureAws cfg s3cfg mgr $
        S3.getObject awss3b filename
    filecontents <- runConduit $ responseBody rsp .| sinkList -- $ DBLC8.unpack $ DBL.fromStrict $ keccak256ToByteString keccakhash
    let header = case takeExtension $ T.unpack filename of
          ".jpg" -> "image/jpg"
          ".jpeg" -> "image/jpeg"
          ".png" -> "image/png"
          ".gif" -> "image/gif"
          ".svg" -> "image/svg+xml"
          ".pdf" -> "application/pdf"
          ".html" -> "text/html"
          ".css" -> "text/css"
          ".js" -> "text/javascript"
          ".json" -> "application/json"
          ".webp" -> "image/webp"
          _ -> "text/plain"
    let contentandbody = ContentTypeAndBody
                           { contentTypeHeader = header
                           , contentTypeBody   = DBL.fromStrict $ DBC8.concat filecontents
                           }
    pure $ ( responseStatus rsp
           , contentandbody
           )
