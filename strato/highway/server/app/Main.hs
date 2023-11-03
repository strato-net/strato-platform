{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE QuasiQuotes #-}

module Main where

import Strato.Server
import BlockApps.Init
import BlockApps.Logging (LogLevel (..), flags_minLogLevel)
import Control.Monad
import Network.HTTP.Client hiding (Proxy)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Cors
import Network.Wai.Middleware.Prometheus
import Network.Wai.Middleware.RequestLogger
import Network.Wai.Middleware.Servant.Options
import Options
import Servant
import Servant.Client (client, mkClientEnv, runClientM)
import Servant.Client.Core (BaseUrl (BaseUrl), Scheme (Http))
import Servant.Multipart.API
import Servant.Multipart.Client
import Text.RawString.QQ as TRQQ
import System.Clock
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
  putStrLn highway3DMacroFont
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering --Do we need this?
  mgr <- newManager defaultManagerSettings
  boundary <- genBoundary
  let burl = BaseUrl Http "localhost" 8080 ""
      runC cli = runClientM cli (mkClientEnv mgr burl)
  resp <- runC $ client serverProxy (boundary, form)
  print resp
  --run 8080 $ server serverProxy


  --let env = Strato23.VaultWrapperEnv mgr pool password cache
  --run flags_port (appVaultWrapper env)

{-
appVaultWrapper :: Strato23.VaultWrapperEnv -> Application
appVaultWrapper env =
  prometheus
    def
      { prometheusEndPoint = ["strato", "v2.3", "metrics"],
        prometheusInstrumentApp = False
      }
    . instrumentApp "vault-wrapper"
    . (if flags_minLogLevel == LevelDebug then logStdoutDev else logStdout)
    . cors (const $ Just policy)
    . provideOptions (Proxy @Strato23.VaultWrapperAPI)
    . serve
      ( Proxy
          @( "strato" :> "v2.3" :> Strato23.VaultWrapperAPI
               :<|> "strato" :> "v2.3" :> Strato23.VaultWrapperDocsAPI
           )
      )
    $ Strato23.serveVaultWrapper env
      :<|> return Strato23.vaultWrapperSwagger
  where
    policy = simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]}
-}
