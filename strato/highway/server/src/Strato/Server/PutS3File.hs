{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeOperators       #-}

module Strato.Server.PutS3File
  ( putS3File 
  )
where

import qualified Aws
import qualified Aws.S3 as S3
import           Control.Exception (throwIO)
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import           Data.ByteString as DB
import           Data.Text as T
import           Network.HTTP.Conduit (RequestBody(..))
import           Servant.Multipart
import           System.FilePath (takeExtension)

import           Strato.Monad
import           Blockchain.Strato.Model.Keccak256

putS3File :: MultipartData Mem 
          -> HighwayM Text
putS3File multipartdata =
  --Ensure we have only a single file input via form.
  case files multipartdata of
    [file] -> do
      --Derive hash (Keccak256?) based on the file contents.
      $logInfoS "highway/putS3File" $ T.pack $ "Deriving hash based on the file contents."
      let content     = toStrict     $
                        fdPayload    $
                        file
      let contentHash = T.pack . keccak256ToHex $ hash content
          extension = T.pack . takeExtension . T.unpack $ fdFileName file
          uploadFileName = contentHash <> extension
      --Set up AWS credentials and the default configuration.
      $logInfoS "highway/putS3File" $ T.pack $ "Setting up AWS credentials and the default AWS configuration."
      mgr    <- asks httpManager
      cr     <- asks awsCredentials
      awss3b <- asks awss3bucket
      hwUrl  <- asks highwayUrl
      let cfg = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                                  , Aws.credentials = cr
                                  , Aws.logger      = Aws.defaultLog Aws.Warning
                                  , Aws.proxy       = Nothing
                                  }
      let s3cfg = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
      --Set up a ResourceT region with an available HTTP manager.
      $logInfoS "highway/putS3File" $ T.pack $ "Setting up a ResourceT region with an available HTTP manager."
      st  <- askUnliftIO
      liftIO $ runResourceT $ do
        let body = RequestBodyBS content
        --Create a request object with S3.getObject and run the request with pureAws.
        liftIO $ unliftIO st $ $logInfoS "highway/putS3File" $ T.pack $ "Creating request object with getObject and running request via pureAws."
        _ <- Aws.pureAws cfg s3cfg mgr $
               S3.putObject awss3b uploadFileName body
        return $ hwUrl <> "/highway/" <> uploadFileName
    _ -> --Too many or no files provided via form.
      liftIO $ throwIO BadPostError
