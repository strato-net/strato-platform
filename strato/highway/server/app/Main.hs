{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE QuasiQuotes       #-}

module Main where

import API
import Strato.Monad
import Strato.Server
import BlockApps.Init
import BlockApps.Logging
import Options

import Control.Monad
import Control.Monad.IO.Unlift
import Data.ByteString.Char8 as DBC8
import Data.Text as T
import HFlags
import Network.HTTP.Client hiding (Proxy)
import Network.HTTP.Client.TLS (tlsManagerSettings)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Cors
import Network.Wai.Middleware.Prometheus
import Servant
import Servant.Multipart.Client
import Text.RawString.QQ as TRQQ
import System.IO
  ( BufferMode (..),
    hSetBuffering,
    stderr,
    stdout,
  )

highway3DMacroFont :: String
highway3DMacroFont =
  [r|
                 _____                    _____                    _____                    _____                    _____                    _____                _____          
                /\    \                  /\    \                  /\    \                  /\    \                  /\    \                  /\    \              |\    \         
               /::\____\                /::\    \                /::\    \                /::\____\                /::\____\                /::\    \             |:\____\        
              /:::/    /                \:::\    \              /::::\    \              /:::/    /               /:::/    /               /::::\    \            |::|   |        
             /:::/    /                  \:::\    \            /::::::\    \            /:::/    /               /:::/   _/___            /::::::\    \           |::|   |        
            /:::/    /                    \:::\    \          /:::/\:::\    \          /:::/    /               /:::/   /\    \          /:::/\:::\    \          |::|   |        
           /:::/____/                      \:::\    \        /:::/  \:::\    \        /:::/____/               /:::/   /::\____\        /:::/__\:::\    \         |::|   |        
          /::::\    \                      /::::\    \      /:::/    \:::\    \      /::::\    \              /:::/   /:::/    /       /::::\   \:::\    \        |::|   |        
         /::::::\    \   _____    ____    /::::::\    \    /:::/    / \:::\    \    /::::::\    \   _____    /:::/   /:::/   _/___    /::::::\   \:::\    \       |::|___|______  
        /:::/\:::\    \ /\    \  /\   \  /:::/\:::\    \  /:::/    /   \:::\ ___\  /:::/\:::\    \ /\    \  /:::/___/:::/   /\    \  /:::/\:::\   \:::\    \      /::::::::\    \ 
       /:::/  \:::\    /::\____\/::\   \/:::/  \:::\____\/:::/____/  ___\:::|    |/:::/  \:::\    /::\____\|:::|   /:::/   /::\____\/:::/  \:::\   \:::\____\    /::::::::::\____\
       \::/    \:::\  /:::/    /\:::\  /:::/    \::/    /\:::\    \ /\  /:::|____|\::/    \:::\  /:::/    /|:::|__/:::/   /:::/    /\::/    \:::\  /:::/    /   /:::/~~~~/~~      
        \/____/ \:::\/:::/    /  \:::\/:::/    / \/____/  \:::\    /::\ \::/    /  \/____/ \:::\/:::/    /  \:::\/:::/   /:::/    /  \/____/ \:::\/:::/    /   /:::/    /         
                 \::::::/    /    \::::::/    /            \:::\   \:::\ \/____/            \::::::/    /    \::::::/   /:::/    /            \::::::/    /   /:::/    /          
                  \::::/    /      \::::/____/              \:::\   \:::\____\               \::::/    /      \::::/___/:::/    /              \::::/    /   /:::/    /           
                  /:::/    /        \:::\    \               \:::\  /:::/    /               /:::/    /        \:::\__/:::/    /               /:::/    /    \::/    /            
                 /:::/    /          \:::\    \               \:::\/:::/    /               /:::/    /          \::::::::/    /               /:::/    /      \/____/             
                /:::/    /            \:::\    \               \::::::/    /               /:::/    /            \::::::/    /               /:::/    /                           
               /:::/    /              \:::\____\               \::::/    /               /:::/    /              \::::/    /               /:::/    /                            
               \::/    /                \::/    /                \::/____/                \::/    /                \::/____/                \::/    /                             
                \/____/                  \/____/                                           \/____/                  ~~                       \/____/                              
                                                                                                                                                                           
  |]

main :: IO ()
main = do
  _ <- $initHFlags "Setup Highway Wrapper AWS settings"
  runLoggingT initHighway

initHighway :: LoggingT IO ()
initHighway = do
  $logInfoS "highway/initHighway" $ T.pack $ "Starting up highway."
  liftIO $ blockappsInit "blockapps-highway-server"
  liftIO $ Prelude.putStrLn highway3DMacroFont
  liftIO $ forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering --Do we need this?
  case Prelude.null flags_awsaccesskeyid of
      True  -> do $logErrorS "highway/initHighway" $ T.pack $ "AWS Access Key ID highway env variable was not passed in."
                  return ()
      False -> case Prelude.null flags_awssecretaccesskey of
                 True  -> do $logErrorS "highway/initHighway" $ T.pack $ "AWS Secret Access Key highway env variable was not passed in."
                             return ()
                 False -> case Prelude.null flags_awss3bucket of
                            True  -> do $logErrorS "highway/initHighway" $ T.pack $ "AWS S3 Bucket highway env variable was not passed in."
                                        return ()
                            False -> do $logInfoS "highway/initHighway" $ T.pack $ "Preparing environment for highway."
                                        mgr <- liftIO $ newManager tlsManagerSettings
                                        boundary <- liftIO genBoundary
                                        let env = HighwayWrapperEnv
                                                    mgr
                                                    boundary
                                                    (DBC8.pack flags_awsaccesskeyid)
                                                    (DBC8.pack flags_awssecretaccesskey)
                                                    (T.pack flags_awss3bucket)
                                                    (T.pack flags_highwayUrl)
                                        $logInfoS "highway/initHighway" $ T.pack $ "Initialization successful!"
                                        liftIO $ run 8080 $ appHighwayWrapper env

appHighwayWrapper :: HighwayWrapperEnv -> Application
appHighwayWrapper env =
  prometheus
    def
      { prometheusEndPoint = ["highway", "metrics"],
        prometheusInstrumentApp = False
      }
    . instrumentApp "highway"
    . cors (const $ Just policy)
    . serve
      ( Proxy
          @( HighwayWrapperAPI
           )
      )
    $ serveHighwayWrapper env
  where
    policy = simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]}
