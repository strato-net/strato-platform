{-# LANGUAGE TypeApplications #-}

module Strato.Client where

import Data.ByteString.Lazy
import Data.Proxy
import Data.Text
import Network.HTTP.Types.Status
import Servant.Client
import Servant.Multipart.Client ()
import Servant.Multipart

import API

highwayPutS3File :: (ByteString,MultipartData Mem)
                 -> ClientM Text
highwayPutS3File = client (Proxy @HighwayPutS3File)

highwayGetS3File :: Text
                 -> ClientM ContentTypeAndBody
highwayGetS3File = client (Proxy @HighwayGetS3File)

highwayGetS3FileTesting :: Text
                        -> ClientM (Status,ContentTypeAndBody)
highwayGetS3FileTesting = client (Proxy @HighwayGetS3FileTesting)

highwayPing :: ClientM Int
highwayPing = client (Proxy @HighwayPing)

highwayWrapperClientAPI :: Proxy HighwayWrapperAPI
highwayWrapperClientAPI = Proxy
