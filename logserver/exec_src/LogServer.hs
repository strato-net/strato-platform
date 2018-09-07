{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Control.Monad
import HFlags
import Network.Wai.Application.Static
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import Network.Wai.Middleware.RequestLogger

defineFlag "d:directory" ("/var/lib/strato/logs" :: String) "Directory to serve the files from"
$(return [])

main :: IO ()
main = do
  unknown <- $initHFlags "Strato Log Server"
  unless (null unknown) . putStrLn $ "Unknown flags: " ++ show unknown
  let settings = defaultFileServerSettings flags_directory
      rawApp = staticApp settings
             { ssGetMimeType = const (return "text/plain")}
      app = prometheus def . logStdoutDev $ rawApp
  putStrLn $ "Serving directory " ++ flags_directory
  run 7065 app
