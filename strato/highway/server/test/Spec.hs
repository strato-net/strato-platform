{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}

module Main where

import           API
--import           Blockchain.Strato.Model.Keccak256
import           Options
import           Strato.Monad
import           Strato.Server
import           Strato.Server.GetS3File (getS3FileTesting)
import           Strato.Server.PutS3File

import qualified Aws as Aws
import qualified Aws.S3 as S3

import           Control.Concurrent
--import           Control.Concurrent.STM.TVar
import           Control.Exception
import           Control.Monad.IO.Class
--import           Control.Monad.STM
import           Control.Monad.Trans.Resource
import           Data.ByteString.Char8 as DBC8
import           Data.ByteString.Lazy as DBL
import           Data.Proxy
import           Data.Text as T
import           Data.Word8
import           HFlags
import           Network.HTTP.Client hiding (Proxy)
import           Network.HTTP.Client.TLS (tlsManagerSettings)
import           Network.HTTP.Types.Status (status200)
import qualified Network.Wai.Handler.Warp as Warp
import           Network.Wai.Middleware.Cors
import           Network.Wai.Parse
import           Servant
import           Servant.Multipart
import           Servant.Multipart.API
import           Servant.Multipart.Client
import           System.Environment
import           System.Random
import           Test.Hspec
import           Text.Regex

randomBytes :: Int
            -> StdGen
            -> [Word8]
randomBytes 0 _      = []
randomBytes count' g =
  fromIntegral value :
    randomBytes (count' - 1) nextG
  where
    (value,nextG) = genWord8 g

randomByteString :: Int
                 -> StdGen
                 -> DBL.ByteString
randomByteString count' g =
  DBL.pack $
    randomBytes count' g

data HighwayTesting = HighwayTesting
  { highwaytesting_inputiname  :: Text
  , highwaytesting_inputivalue :: Text
  , highwaytesting_inputname   :: Text
  , highwaytesting_filename    :: Text
  , highwaytesting_filetype    :: Text
  , highwaytesting_data        :: DBL.ByteString
  }

instance ToMultipart Mem HighwayTesting where
  toMultipart highwaytesting =
    MultipartData
      { inputs =
          [ Input (highwaytesting_inputiname  highwaytesting)
                  (highwaytesting_inputivalue highwaytesting)
          ]
      , files =
          [ FileData (highwaytesting_inputname highwaytesting)
                     (highwaytesting_filename  highwaytesting)
                     (highwaytesting_filetype  highwaytesting)
                     (highwaytesting_data      highwaytesting)
          ]
      }

fourMBBasicTest :: String
                -> String
                -> S3.Bucket
                -> Text
                -> HighwayWrapperEnv
                -> Spec
fourMBBasicTest highwaytestnetaccesskeyid
                highwaytestnetsecretaccesskey
                highwaytestnets3bucket
                highwaytestneturl
                env = do
  it "Can push a pseudo randomly-generated 4MB text file to AWS S3 via putS3File,\
     \ and retrieve that same file via getS3FileTesting,\
     \ (cleaning up afterward with DeleteObject)." $ do
    --fourmbteststore        <- newTVar DBL.empty
    g                      <- getStdGen
    let fourmbtestdata     = randomByteString 4000000
                                              g
    {-
    let contenthash        = T.pack . keccak256ToHex $
                               hash                  $
                                DBL.toStrict fourmbtestdata
    _                      <-
      atomically $
        writeTVar fourmbteststore
                  contenthash
    contenthash'           <- readTVarIO fourmbteststore
    contenthash `shouldBe` contenthash'
    -}
    let fourmbtestdatatype = HighwayTesting
                               { highwaytesting_inputiname  = "highway-testing" :: Text
                               , highwaytesting_inputivalue = "4MB Tests" :: Text
                               , highwaytesting_inputname   = "4MBTest" :: Text
                               , highwaytesting_filename    = "4mbtest.txt" :: Text
                               , highwaytesting_filetype    = "text/plain" :: Text
                               , highwaytesting_data        = fourmbtestdata
                               } 
    let multipart          = toMultipart fourmbtestdatatype 
    mgr                    <- newManager tlsManagerSettings
    --boundary               <- genBoundary
    cr                     <- Aws.makeCredentials (DBC8.pack highwaytestnetaccesskeyid)
                                                  (DBC8.pack highwaytestnetsecretaccesskey)
    let cfg                = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                                               , Aws.credentials = cr 
                                               , Aws.logger      = Aws.defaultLog Aws.Warning
                                               , Aws.proxy       = Nothing
                                               }
    let s3cfg              = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
    --let env                = HighwayWrapperEnv
    --                           mgr
    --                           cr
    --                           boundary
    --                           highwaytestnets3bucket
    --                           highwaytestneturl
    filename               <-
      runHighwayWithEnv env
                        (putS3File multipart)
    let hash               = T.pack $
                               subRegex ( mkRegex ((T.unpack highwaytestneturl) ++ "/highway/")
                                        )
                                        ( T.unpack filename
                                        )
                                        ""
    (rsp,_)                <-
      runHighwayWithEnv env
                        (getS3FileTesting hash)
    _ <-
      runResourceT $
        Aws.pureAws cfg s3cfg mgr $
          S3.DeleteObject hash highwaytestnets3bucket
    rsp  `shouldBe` status200

fiveMBBasicTest :: String
                -> String
                -> S3.Bucket
                -> Text
                -> HighwayWrapperEnv
                -> Spec
fiveMBBasicTest highwaytestnetaccesskeyid
                highwaytestnetsecretaccesskey
                highwaytestnets3bucket
                highwaytestneturl
                env = do
  it "Can push a pseudo randomly-generated 5MB text file to AWS S3 via putS3File,\
     \ and retrieve that same file via getS3FileTesting,\
     \ (cleaning up afterward with DeleteObject)." $ do
    g                      <- getStdGen
    let fivembtestdata     = randomByteString 5000000
                                              g
    let fivembtestdatatype = HighwayTesting
                               { highwaytesting_inputiname  = "highway-testing" :: Text
                               , highwaytesting_inputivalue = "5MB Tests" :: Text
                               , highwaytesting_inputname   = "5MBTest" :: Text
                               , highwaytesting_filename    = "5mbtest.txt" :: Text
                               , highwaytesting_filetype    = "text/plain" :: Text
                               , highwaytesting_data        = fivembtestdata
                               } 
    let multipart          = toMultipart fivembtestdatatype 
    mgr                    <- newManager tlsManagerSettings
    --boundary               <- genBoundary
    cr                     <- Aws.makeCredentials (DBC8.pack highwaytestnetaccesskeyid)
                                                  (DBC8.pack highwaytestnetsecretaccesskey)
    let cfg                = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                                               , Aws.credentials = cr 
                                               , Aws.logger      = Aws.defaultLog Aws.Warning
                                               , Aws.proxy       = Nothing
                                               }
    let s3cfg              = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
    --let env                = HighwayWrapperEnv
    --                           mgr
    --                           cr
    --                           boundary
    --                           highwaytestnets3bucket
    --                           highwaytestneturl
    filename               <-
      runHighwayWithEnv env
                        (putS3File multipart)
    let hash               = T.pack $
                               subRegex ( mkRegex ((T.unpack highwaytestneturl) ++ "/highway/")
                                        )
                                        ( T.unpack filename
                                        )
                                        ""
    (rsp,_)                <-
      runHighwayWithEnv env
                        (getS3FileTesting hash)
    _ <-
      runResourceT $
        Aws.pureAws cfg s3cfg mgr $
          S3.DeleteObject hash highwaytestnets3bucket
    rsp `shouldBe` status200

sixMBBasicTest :: String
               -> String
               -> S3.Bucket
               -> Text
               -> HighwayWrapperEnv
               -> Spec
sixMBBasicTest highwaytestnetaccesskeyid
               highwaytestnetsecretaccesskey
               highwaytestnets3bucket
               highwaytestneturl
               env = do
  it "Cannot push a pseudo randomly-generated 6MB text file to AWS S3 via putS3File,\
     \ and retrieve that same file via getS3FileTesting,\
     \ (cleaning up afterward with DeleteObject)." $ do
    g                     <- getStdGen
    let sixmbtestdata     = randomByteString 6000000
                                             g
    let sixmbtestdatatype = HighwayTesting
                               { highwaytesting_inputiname  = "highway-testing" :: Text
                               , highwaytesting_inputivalue = "6MB Tests" :: Text
                               , highwaytesting_inputname   = "6MBTest" :: Text
                               , highwaytesting_filename    = "6mbtest.txt" :: Text
                               , highwaytesting_filetype    = "text/plain" :: Text
                               , highwaytesting_data        = sixmbtestdata
                               } 
    let multipart          = toMultipart sixmbtestdatatype 
    mgr                    <- newManager tlsManagerSettings
    --boundary               <- genBoundary
    cr                     <- Aws.makeCredentials (DBC8.pack highwaytestnetaccesskeyid)
                                                  (DBC8.pack highwaytestnetsecretaccesskey)
    let cfg                = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                                               , Aws.credentials = cr 
                                               , Aws.logger      = Aws.defaultLog Aws.Warning
                                               , Aws.proxy       = Nothing
                                               }
    let s3cfg              = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
    --let env                = HighwayWrapperEnv
    --                           mgr
    --                           cr
    --                           boundary
    --                           highwaytestnets3bucket
    --                           highwaytestneturl
    filename               <-
      runHighwayWithEnv env
                        (putS3File multipart)
    let hash               = T.pack $
                               subRegex ( mkRegex ((T.unpack highwaytestneturl) ++ "/highway/")
                                        )
                                        ( T.unpack filename
                                        )
                                        ""
    (rsp,_)                <-
      runHighwayWithEnv env
                        (getS3FileTesting hash)
    _ <-
      runResourceT $
        Aws.pureAws cfg s3cfg mgr $
          S3.DeleteObject hash highwaytestnets3bucket
    rsp `shouldNotBe` status200

main :: IO ()
main = do
  _ <- $initHFlags "Setup Highway Wrapper AWS settings - Testing"
  case Prelude.null flags_awsaccesskeyid of
    True  ->
      return ()
    False ->
      case Prelude.null flags_awssecretaccesskey of
        True  ->
          return ()
        False ->
          case Prelude.null flags_awss3bucket of
            True  ->
              return ()
            False -> do
              let highwayawsaccesskeyid = flags_awsaccesskeyid
              let highwayawssecretaccesskey = flags_awssecretaccesskey
              let highwayawss3bucket = flags_awss3bucket
              mgr      <- newManager tlsManagerSettings
              boundary <- genBoundary
              cr       <- Aws.makeCredentials (DBC8.pack highwayawsaccesskeyid)
                                              (DBC8.pack highwayawssecretaccesskey)
              let env  = HighwayWrapperEnv
                           mgr
                           cr
                           boundary
                           (T.pack highwayawss3bucket)
                           highwaytestneturl
              withArgs [] $
                hspec     $
                  aroundAll_ ( highwayTestingSetup --highwayawsaccesskeyid
                                                   --highwayawssecretaccesskey
                                                   --highwayawss3bucket
                                                   env
                             ) $ do
                    describe "highway" $ do
                      describe "base tests" $ do
                        describe "4MB testing" $ do
                          fourMBBasicTest highwayawsaccesskeyid
                                          highwayawssecretaccesskey
                                          (T.pack highwayawss3bucket)
                                          highwaytestneturl
                                          env  
                        describe "5MB testing" $ do
                          fiveMBBasicTest highwayawsaccesskeyid
                                          highwayawssecretaccesskey
                                          (T.pack highwayawss3bucket)
                                          highwaytestneturl
                                          env
                        describe "6MB testing" $ do
                          sixMBBasicTest highwayawsaccesskeyid
                                         highwayawssecretaccesskey
                                         (T.pack highwayawss3bucket)
                                         highwaytestneturl
                                         env
  where
    highwaytestneturl = "localhost" :: Text
    highwayTestingSetup --highwayawsaccesskeyid
                        --highwayawssecretaccesskey
                        --highwaytestnets3bucket
                        env
                        action = --do
      {-
      mgr      <- newManager tlsManagerSettings
      boundary <- genBoundary
      cr       <- Aws.makeCredentials (DBC8.pack highwayawsaccesskeyid)
                                      (DBC8.pack highwayawssecretaccesskey)
      let env = HighwayWrapperEnv
                  mgr
                  cr
                  boundary
                  (T.pack highwaytestnets3bucket)
                  highwaytestneturl
      -}
      bracket (liftIO $ forkIO $ Warp.run 8080 (appHighwayWrapper env))
              killThread
              (const action)
      where
        appHighwayWrapper :: HighwayWrapperEnv
                          -> Application
        appHighwayWrapper env' =
          cors (const $ Just policy) 
          . serveWithContext
              ( Proxy
                  @( HighwayWrapperAPI
                   )
              ) ctx''
          $ serveHighwayWrapper env'
          where
            ctx    = setMaxRequestKeyLength 100 defaultParseRequestBodyOptions
            ctx'   = setMaxRequestFileSize 5000000 ctx
            ctx''  :: Context '[MultipartOptions Mem]
            ctx''  = (MultipartOptions ctx' ()) :. EmptyContext
            policy = simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]}
