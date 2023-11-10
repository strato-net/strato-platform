{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE QuasiQuotes #-}

module Main where

import API
import Strato.Monad
import Strato.Server
import BlockApps.Init
--import BlockApps.Logging (LogLevel (..), flags_minLogLevel)
import Options

import Data.ByteString.Char8 as DBC8
import Data.Text as T
import Control.Monad
import HFlags
import Network.HTTP.Client hiding (Proxy)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Cors
import Network.Wai.Middleware.Prometheus
--import Network.Wai.Middleware.RequestLogger
--import Network.Wai.Middleware.Servant.Options
--import Options
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
  blockappsInit "blockapps-highway-wrapper-server"
  Prelude.putStrLn highway3DMacroFont
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering --Do we need this?
  _   <- $initHFlags "Setup Highway Wrapper AWS settings"
  mgr <- newManager defaultManagerSettings
  boundary <- genBoundary
  let env = HighwayWrapperEnv mgr boundary (DBC8.pack flags_awsaccesskeyid) (DBC8.pack flags_awssecretaccesskey) (T.pack flags_awss3bucket)
  run 8080 $ appHighwayWrapper env

appHighwayWrapper :: HighwayWrapperEnv -> Application
appHighwayWrapper env =
  prometheus
    def
      { prometheusEndPoint = ["highway", "metrics"],
        prometheusInstrumentApp = False
      }
    . instrumentApp "highway-wrapper"
    -- . (if flags_minLogLevel == LevelDebug then logStdoutDev else logStdout)
    . cors (const $ Just policy)
    -- . provideOptions (Proxy @HighwayWrapperAPI)
    . serve
      ( Proxy
          @( "highway" :> HighwayWrapperAPI
           --    :<|> "strato" :> "v2.3" :> Strato23.VaultWrapperDocsAPI
           )
      )
    $ serveHighwayWrapper env
      -- :<|> return Strato23.vaultWrapperSwagger
  where
    policy = simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]}
