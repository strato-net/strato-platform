{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

import BlockApps.Init
import BlockApps.Logging (LogLevel (..), flags_minLogLevel)
import BlockApps.X509.Keys (bsToPriv)
import Blockchain.Strato.Model.Secp256k1
import Control.Monad
import qualified Data.ByteString as B
import HFlags
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Cors
import Network.Wai.Middleware.Prometheus
import Network.Wai.Middleware.RequestLogger
import Network.Wai.Middleware.Servant.Options
import PemOptions
import Servant
import qualified Strato.Strato23.API as Strato23
import qualified Strato.Strato23.PemServer as Strato23
import qualified Strato.Strato23.Server as Strato23
import System.IO
  ( BufferMode (..),
    hSetBuffering,
    stderr,
    stdout,
  )

main :: IO ()
main = do
  blockappsInit "blockapps-vault-wrapper-server"
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering
  putStrLn . unlines $
    [ "@@@  @@@  @@@@@@  @@@  @@@ @@@    @@@@@@@     @@@  @@@  @@@ @@@@@@@   @@@@@@  @@@@@@@  @@@@@@@  @@@@@@@@ @@@@@@@ ",
      "@@@  @@@ @@@@@@@@ @@@  @@@ @@@    @@@@@@@     @@@  @@@  @@@ @@@@@@@@ @@@@@@@@ @@@@@@@@ @@@@@@@@ @@@@@@@@ @@@@@@@@",
      "@@!  @@@ @@!  @@@ @@!  @@@ @@!      @@!       @@!  @@!  @@! @@!  @@@ @@!  @@@ @@!  @@@ @@!  @@@ @@!      @@!  @@@",
      "!@!  @!@ !@!  @!@ !@!  @!@ !@!      !@!       !@!  !@!  !@! !@!  @!@ !@!  @!@ !@!  @!@ !@!  @!@ !@!      !@!  @!@",
      "@!@  !@! @!@!@!@! @!@  !@! @!!      @!!       @!!  !!@  @!@ @!@!!@!  @!@!@!@! @!@@!@!  @!@@!@!  @!!!:!   @!@!!@! ",
      "!@!  !!! !!!@!!!! !@!  !!! !!!      !!!       !@!  !!!  !@! !!@!@!   !!!@!!!! !!@!!!   !!@!!!   !!!!!:   !!@!@!  ",
      ":!:  !!: !!:  !!! !!:  !!! !!:      !!:       !!:  !!:  !!: !!: :!!  !!:  !!! !!:      !!:      !!:      !!: :!! ",
      " ::!!:!  :!:  !:! :!:  !:!  :!:     :!:       :!:  :!:  :!: :!:  !:! :!:  !:! :!:      :!:      :!:      :!:  !:!",
      "  ::::   ::   ::: ::::: ::  :: ::::  ::        :::: :: :::  ::   ::: ::   :::  ::       ::       :: :::: ::   :::",
      "   :      :   : :  : :  :  : :: : :  :          :: :  : :    :   : :  :   : :  :        :       : :: ::   :   : :"
    ]
  _ <- $initHFlags "Setup Vault Wrapper DBs"
  pkBS <- B.readFile flags_PEM_FILE
  let ePK = bsToPriv pkBS
  case ePK of
    Left err -> error $ "Could not decode private key: " ++ err
    Right pk -> run flags_port (appVaultWrapper pk)

appVaultWrapper :: PrivateKey -> Application
appVaultWrapper pk =
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
          @( Get '[JSON] ()
            :<|> "strato" :> "v2.3" :> Strato23.VaultWrapperAPI' '[]
            :<|> "strato" :> "v2.3" :> Strato23.VaultWrapperDocsAPI
           )
      )
    $ pure ()
      :<|> Strato23.servePemVaultWrapper pk
      :<|> return Strato23.vaultWrapperSwagger
  where
    policy = simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]}
