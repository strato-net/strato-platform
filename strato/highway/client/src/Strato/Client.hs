{-# LANGUAGE TypeApplications #-}

module Strato.Client
  --( getS3File,
  --  putS3File
  --)
where

import Data.Proxy
--import Servant.Client

--import Blockchain.Strato.Model.Keccak256
import API

highwayWrapperClientAPI :: Proxy HighwayWrapperAPI
highwayWrapperClientAPI = Proxy

{-
highwayPutS3FileClientAPI :: Proxy HighwayPutS3File
highwayPutS3FileClientAPI = Proxy

getS3File :: Keccak256
          -> ClientM ContentTypeAndBody
getS3File = client (Proxy @HighwayGetS3File)

putS3File :: Proxy HighwayPutS3File
putS3File = highwayPutS3FileClientAPI
-}
