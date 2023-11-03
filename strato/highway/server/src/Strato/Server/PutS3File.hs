{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE FlexibleContexts    #-}
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
import           Data.ByteString.Char8 as DBC8
import           Data.ByteString.UTF8 as BLU
import           Data.Text as T
import           Data.Text.Encoding as DTE
import           Network.HTTP.Conduit (RequestBody(..))
import           Servant.Multipart
import           Servant.Multipart.API
--import           System.IO
--import           System.Posix.Files

import           Strato.Monad
import           Blockchain.Strato.Model.Keccak256


--putS3File :: ( MonadUnliftIO m
--             , MonadLogger m
--             )
--          => MultipartData Mem -> m ()
--putS3File :: ( MultipartResult tag ~ ByteString
--             , MonadUnliftIO m
--             , MonadReader HighwayWrapperEnv m
--             , MonadLogger m
--             ) => MultipartData tag -> m ()
putS3File :: ( MultipartResult tag ~ ByteString
             )
          => MultipartData tag 
          -> HighwayM ()
putS3File multipartdata =
  --Ensure we have only a single file input via form.
  case ((Prelude.length $ files multipartdata) == 1) of
    False -> --Too many or no files provided via form.
             return ()
    True  -> do --Derive hash (Keccak256?) based on the file contents.
                $logInfoS "highway/putS3File" $ T.pack $ "Deriving hash based on the file contents."
                let content     = fdPayload    $
                                  Prelude.head $
                                  files multipartdata
                --contentf        <- liftIO $ DBC8.readFile content
                let contenthash = decodeUtf8 $ keccak256ToByteString $ unsafeCreateKeccak256FromByteString content
                --Set up AWS credentials and the default configuration.
                $logInfoS "highway/putS3File" $ T.pack $ "Setting up AWS credentials and the default AWS configuration."
                cr <- liftIO $ Aws.makeCredentials (BLU.fromString "AKIAV5NMROVZIZQY4OAE")
                                                   (BLU.fromString "4/AGZk38zd5kkHzsHmObyst8v+o2SjoESH8qAWQG")
                let cfg = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                                            , Aws.credentials = cr
                                            , Aws.logger      = Aws.defaultLog Aws.Warning
                                            , Aws.proxy       = Nothing
                                            }
                let s3cfg = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
                --Set up a ResourceT region with an available HTTP manager.
                $logInfoS "highway/getS3File" $ T.pack $ "Setting up a ResourceT region with an available HTTP manager."
                mgr <- asks httpManager
                st  <- askUnliftIO
                liftIO $ runResourceT $ do
                  --Streams large file content, without buffering more than 10k in memory.
                  --let streamer sink = withFile content ReadMode $ \h -> sink $ DBC8.hGet h 10240
                  --size <- liftIO $ (fromIntegral . fileSize <$> getFileStatus content :: IO Integer)
                  --let body = RequestBodyStream (fromInteger size) streamer
                  let body = RequestBodyBS content
                  --Create a request object with S3.getObject and run the request with pureAws.
                  liftIO $ unliftIO st $ $logInfoS "highway/putS3File" $ T.pack $ "Creating request object with getObject and running request via pureAws."
                  _ <- Aws.pureAws cfg s3cfg mgr $
                         S3.putObject "mercata-testnet2" contenthash body
                  return ()
