{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}

module Main where

import           API
import           Blockchain.Strato.Model.Keccak256
import           Options
import           Strato.Monad
import           Strato.Client
import           Strato.Server

import qualified Aws    as Aws
import qualified Aws.S3 as S3

import           Control.Concurrent
import           Control.Exception
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import           Data.ByteString.Char8 as DBC8
import           Data.ByteString.Lazy as DBL
import qualified Data.ByteString.Lazy.UTF8 as DBLUTF8
import           Data.Proxy
import           Data.Text as T
import           HFlags
import           Network.HTTP.Client hiding (Proxy)
import           Network.HTTP.Client.TLS (tlsManagerSettings)
import           Network.HTTP.Types.Status (status200,status413,status500)
import qualified Network.Wai.Handler.Warp as Warp
import           Network.Wai.Middleware.Cors
import           Network.Wai.Parse
import           Servant
import           Servant.Client
import           Servant.Client.Core.BaseUrl ()
import           Servant.Multipart
import           Servant.Multipart.API
import           Servant.Multipart.Client
import           System.Environment
import           System.Random
import           Test.Hspec
import           Test.HUnit.Lang
import           Text.Regex

randomBytes :: Int
            -> StdGen
            -> [Char]
randomBytes 0 _      = []
randomBytes count' g =
  value :
    randomBytes (count' - 1) nextG
  where
    (value,nextG) =
      let (value',nextG') = randomR (32,126) --ASCII range for simplicity
                                    g
      in (toEnum value',nextG')

randomByteString :: Int
                 -> StdGen
                 -> DBL.ByteString
randomByteString count' g =
  DBLUTF8.fromString $
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
                -> Spec
fourMBBasicTest highwaytestnetaccesskeyid
                highwaytestnetsecretaccesskey
                highwaytestnets3bucket
                highwaytestneturl =
  it "Can push a pseudo randomly-generated 4MB text file to AWS S3 via putS3File,\
     \ and retrieve that same file via getS3FileTesting,\
     \ (cleaning up afterward with DeleteObject)." $ do
    g                      <- getStdGen
    let fourmbtestdata     = randomByteString 4000000
                                              g
    let fourmbtestdatatype = HighwayTesting
                               { highwaytesting_inputiname  = "4MBtest.txt" :: Text
                               , highwaytesting_inputivalue = "4MB Tests" :: Text
                               , highwaytesting_inputname   = "4MBTest" :: Text
                               , highwaytesting_filename    = "4mbtest.txt" :: Text
                               , highwaytesting_filetype    = "text/plain" :: Text
                               , highwaytesting_data        = fourmbtestdata
                               } 
    let multipart          = toMultipart fourmbtestdatatype
    mgr                    <- newManager tlsManagerSettings
    let puts3fileclientenv = mkClientEnv mgr
                                         BaseUrl { baseUrlScheme  = Http
                                                 , baseUrlHost    = T.unpack highwaytestneturl
                                                 , baseUrlPort    = 8080
                                                 , baseUrlPath    = ""
                                                 }
    boundary               <- liftIO genBoundary
    let putS3File'         = runClientM (highwayPutS3File (boundary,multipart))
    eresponse              <- liftIO $ putS3File' puts3fileclientenv
    case eresponse of
      Left clienterr ->
        assertFailure $ "Error: \n" ++ show clienterr
      Right response -> do
        let hash'               = T.pack $
                                    subRegex ( mkRegex ((T.unpack highwaytestneturl) ++ "/highway/")
                                             )
                                             ( T.unpack response
                                             )
                                             ""
        let gets3filetestingclientenv = mkClientEnv mgr
                                                    BaseUrl { baseUrlScheme = Http
                                                            , baseUrlHost   = (T.unpack highwaytestneturl)
                                                            , baseUrlPort   = 8080
                                                            , baseUrlPath   = "" 
                                                            }
        let gets3filetesting' = runClientM (highwayGetS3FileTesting hash')
        eresponse'            <- liftIO $ gets3filetesting' gets3filetestingclientenv
        case eresponse' of
          Left clienterr      ->
            assertFailure $ show clienterr
          Right (rsp,content) -> do
            cr                     <- Aws.makeCredentials (DBC8.pack highwaytestnetaccesskeyid)
                                                          (DBC8.pack highwaytestnetsecretaccesskey)
            let cfg                = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                                                       , Aws.credentials = cr 
                                                       , Aws.logger      = Aws.defaultLog Aws.Warning
                                                       , Aws.proxy       = Nothing
                                                       }
            let s3cfg              = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
            _ <-
              runResourceT $
                Aws.pureAws cfg s3cfg mgr $
                  S3.DeleteObject hash' highwaytestnets3bucket
            let contenthash = T.pack . keccak256ToHex $
                                hash                  $
                                  DBL.toStrict fourmbtestdata
            let hash''      = T.pack $
                                subRegex ( mkRegex ".txt"
                                         )
                                         ( T.unpack hash'
                                         )
                                         ""
            rsp                       `shouldBe` status200
            hash''                    `shouldBe` contenthash
            (contentTypeBody content) `shouldBe` fourmbtestdata

fiveMBBasicTest :: String
                -> String
                -> S3.Bucket
                -> Text
                -> Spec
fiveMBBasicTest highwaytestnetaccesskeyid
                highwaytestnetsecretaccesskey
                highwaytestnets3bucket
                highwaytestneturl =
  it "Can push a pseudo randomly-generated 5MB text file to AWS S3 via putS3File,\
     \ and retrieve that same file via getS3FileTesting,\
     \ (cleaning up afterward with DeleteObject)." $ do
    g                      <- getStdGen
    let fivembtestdata     = randomByteString 4500000
                                              g
    let fivembtestdatatype = HighwayTesting
                               { highwaytesting_inputiname  = "5MBtest.txt" :: Text
                               , highwaytesting_inputivalue = "5MB Tests" :: Text
                               , highwaytesting_inputname   = "5MBTest" :: Text
                               , highwaytesting_filename    = "5mbtest.txt" :: Text
                               , highwaytesting_filetype    = "text/plain" :: Text
                               , highwaytesting_data        = fivembtestdata
                               } 
    let multipart          = toMultipart fivembtestdatatype
    mgr                    <- newManager tlsManagerSettings
    let puts3fileclientenv = mkClientEnv mgr
                                         BaseUrl { baseUrlScheme  = Http
                                                 , baseUrlHost    = T.unpack highwaytestneturl
                                                 , baseUrlPort    = 8080
                                                 , baseUrlPath    = ""
                                                 }
    boundary               <- liftIO genBoundary
    let putS3File'         = runClientM (highwayPutS3File (boundary,multipart))
    eresponse              <- liftIO $ putS3File' puts3fileclientenv
    case eresponse of
      Left clienterr -> 
        assertFailure $ "Error: \n" ++ show clienterr
      Right response -> do
        let hash'               = T.pack $
                                    subRegex ( mkRegex ((T.unpack highwaytestneturl) ++ "/highway/")
                                             )
                                             ( T.unpack response
                                             )
                                             ""
        let gets3filetestingclientenv = mkClientEnv mgr
                                                    BaseUrl { baseUrlScheme = Http
                                                            , baseUrlHost   = (T.unpack highwaytestneturl)
                                                            , baseUrlPort   = 8080
                                                            , baseUrlPath   = "" 
                                                            }
        let gets3filetesting' = runClientM (highwayGetS3FileTesting hash')
        eresponse'            <- liftIO $ gets3filetesting' gets3filetestingclientenv
        case eresponse' of
          Left clienterr      ->
            assertFailure $ show clienterr
          Right (rsp,content) -> do
            cr                     <- Aws.makeCredentials (DBC8.pack highwaytestnetaccesskeyid)
                                                          (DBC8.pack highwaytestnetsecretaccesskey)
            let cfg                = Aws.Configuration { Aws.timeInfo    = Aws.Timestamp
                                                       , Aws.credentials = cr 
                                                       , Aws.logger      = Aws.defaultLog Aws.Warning
                                                       , Aws.proxy       = Nothing
                                                       }
            let s3cfg              = Aws.defServiceConfig :: S3.S3Configuration Aws.NormalQuery
            _ <-
              runResourceT $
                Aws.pureAws cfg s3cfg mgr $
                  S3.DeleteObject hash' highwaytestnets3bucket
            let contenthash = T.pack . keccak256ToHex $
                                hash                  $
                                  DBL.toStrict fivembtestdata
            let hash''      = T.pack $
                                subRegex ( mkRegex ".txt"
                                         )
                                         ( T.unpack hash'
                                         )
                                         ""
            rsp                       `shouldBe` status200
            hash''                    `shouldBe` contenthash
            (contentTypeBody content) `shouldBe` fivembtestdata

sixMBBasicTest :: Text
               -> Spec
sixMBBasicTest highwaytestneturl =
  it "Cannot push a pseudo randomly-generated 6MB text file\
     \ to AWS S3 via putS3File." $ do
    g                     <- getStdGen
    let sixmbtestdata     = randomByteString 6000000
                                             g
    let sixmbtestdatatype = HighwayTesting
                              { highwaytesting_inputiname  = "6mbtest.txt" :: Text
                              , highwaytesting_inputivalue = "6MB Tests" :: Text
                              , highwaytesting_inputname   = "6MBTest" :: Text
                              , highwaytesting_filename    = "6mbtest.txt" :: Text
                              , highwaytesting_filetype    = "text/plain" :: Text
                              , highwaytesting_data        = sixmbtestdata
                              } 
    let multipart          = toMultipart sixmbtestdatatype
    mgr                    <- newManager tlsManagerSettings
    let puts3fileclientenv = mkClientEnv mgr
                                         BaseUrl { baseUrlScheme  = Http
                                                 , baseUrlHost    = T.unpack highwaytestneturl
                                                 , baseUrlPort    = 8080
                                                 , baseUrlPath    = ""
                                                 }
    boundary               <- liftIO genBoundary
    let putS3File'         = runClientM (highwayPutS3File (boundary,multipart))
    eresponse              <- liftIO $ putS3File' puts3fileclientenv
    case eresponse of
      Left clienterr -> 
        case clienterr of
          FailureResponse _ resp     -> do
            let rsp = responseStatusCode resp
            rsp `shouldBe` status413
          DecodeFailure _ _          ->
            assertFailure "6MB test failed: The body count not be decoded at the expected type."
          UnsupportedContentType _ _ ->
            assertFailure "6MB test failed: The content-type of the response is not supported."
          InvalidContentTypeHeader _ ->
            assertFailure "6MB test failed: The content-type header is invalid."
          ConnectionError exception  ->
            assertFailure ( "6MB test failed: There was a connection error, and no response was received: \n" ++
                            show exception
                          )
      Right _        ->
        assertFailure "6MB test failed: Should have failed due to server context set at a maximum file size of 5MB."

filenameLengthTest :: Text
                   -> Spec
filenameLengthTest highwaytestneturl =
  it "Cannot push a pseudo randomly-generated 4MB text file,\
     \ with a 109 character long filename (including the file extension),\
     \ to AWS S3 via putS3File." $ do
    g                        <- getStdGen
    let filenamethatstoolong = "4mblongfilenamelengthtestthisshouldfailbecausetherearetoomanycharactersinthefilenamewithalengthlimitof109whichissurelytoolong.txt"
    let fourmbtestdata        = randomByteString 4000000
                                                 g
    let fourmbtestdatatype    = HighwayTesting
                                  { highwaytesting_inputiname  = T.pack filenamethatstoolong
                                  , highwaytesting_inputivalue = "4MB Tests" :: Text
                                  , highwaytesting_inputname   = "4MBTest" :: Text
                                  , highwaytesting_filename    = T.pack filenamethatstoolong
                                  , highwaytesting_filetype    = "text/plain" :: Text
                                  , highwaytesting_data        = fourmbtestdata
                                  } 
    let multipart            = toMultipart fourmbtestdatatype
    mgr                      <- newManager tlsManagerSettings
    let puts3fileclientenv   = mkClientEnv mgr
                                           BaseUrl { baseUrlScheme  = Http
                                                   , baseUrlHost    = T.unpack highwaytestneturl
                                                   , baseUrlPort    = 8080
                                                   , baseUrlPath    = ""
                                                   }
    boundary                 <- liftIO genBoundary
    let putS3File'           = runClientM (highwayPutS3File (boundary,multipart))
    eresponse                <- liftIO $ putS3File' puts3fileclientenv
    case eresponse of
      Left clienterr ->
        case clienterr of
          FailureResponse _ resp     -> do
            let rsp = responseStatusCode resp
            rsp `shouldBe` status500
          DecodeFailure _ _          ->
            assertFailure "6MB test failed: The body count not be decoded at the expected type."
          UnsupportedContentType _ _ ->
            assertFailure "6MB test failed: The content-type of the response is not supported."
          InvalidContentTypeHeader _ ->
            assertFailure "6MB test failed: The content-type header is invalid."
          ConnectionError exception  ->
            assertFailure ( "6MB test failed: There was a connection error, and no response was received: \n" ++
                            show exception
                          )
      Right _        ->
        assertFailure "Filename length test failed: Should have failed due to server context set at a maximum filename length of 100 characters."

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
              let highwaytestneturl = flags_highwayUrl
              withArgs [] $
                hspec     $
                  aroundAll_ ( highwayTestingSetup highwayawsaccesskeyid
                                                   highwayawssecretaccesskey
                                                   highwayawss3bucket
                                                   (T.pack highwaytestneturl) 
                             ) $ do
                    describe "highway" $ do
                      describe "base tests" $ do
                        describe "4MB testing" $ do
                          fourMBBasicTest highwayawsaccesskeyid
                                          highwayawssecretaccesskey
                                          (T.pack highwayawss3bucket)
                                          (T.pack highwaytestneturl)
                        describe "5MB testing" $ do
                          fiveMBBasicTest highwayawsaccesskeyid
                                          highwayawssecretaccesskey
                                          (T.pack highwayawss3bucket)
                                          (T.pack highwaytestneturl)
                        describe "6MB testing" $ do
                          sixMBBasicTest (T.pack highwaytestneturl)
                        describe "Filename length testing" $ do
                          filenameLengthTest (T.pack highwaytestneturl)
  where
    highwayTestingSetup highwayawsaccesskeyid
                        highwayawssecretaccesskey
                        highwaytestnets3bucket
                        highwaytestneturl
                        action = do
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
            ctx'   = setMaxRequestFilesSize 5000000 ctx
            ctx''  :: Context '[MultipartOptions Mem]
            ctx''  = (MultipartOptions ctx' ()) :. EmptyContext
            policy = simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]}
