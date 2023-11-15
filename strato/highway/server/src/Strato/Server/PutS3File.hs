{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeOperators       #-}

module Strato.Server.PutS3File
  ( putS3File 
  )
where

import qualified Aws
import qualified Aws.S3 as S3
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import           Data.ByteString as DB
import           Data.Text as T
import           Data.Text.Encoding as DTE
import           Network.HTTP.Conduit (RequestBody(..))
import           Servant.Multipart

import           Strato.Monad
import           Blockchain.Strato.Model.Keccak256


putS3File :: MultipartData Mem 
          -> HighwayM ()
putS3File multipartdata =
  --Ensure we have only a single file input via form.
  case ((Prelude.length $ files multipartdata) == 1) of
    False -> --Too many or no files provided via form.
             return ()
    True  -> do --Derive hash (Keccak256?) based on the file contents.
                $logInfoS "highway/putS3File" $ T.pack $ "Deriving hash based on the file contents."
                let content     = toStrict     $
                                  fdPayload    $
                                  Prelude.head $
                                  files multipartdata

                let contenthash = decodeUtf8 $ keccak256ToByteString $ unsafeCreateKeccak256FromByteString content
                --Set up AWS credentials and the default configuration.
                $logInfoS "highway/putS3File" $ T.pack $ "Setting up AWS credentials and the default AWS configuration."
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
                st  <- askUnliftIO
                liftIO $ runResourceT $ do
                  let body = RequestBodyBS content
                  --Create a request object with S3.getObject and run the request with pureAws.
                  liftIO $ unliftIO st $ $logInfoS "highway/putS3File" $ T.pack $ "Creating request object with getObject and running request via pureAws."
                  _ <- Aws.pureAws cfg s3cfg mgr $
                         S3.putObject awss3b contenthash body
                  return ()
