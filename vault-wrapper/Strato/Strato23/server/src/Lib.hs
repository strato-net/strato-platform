module Lib
    ( someFunc
    ) where

import Strato.Strato23.Server (router)
import Network.Wai
import Network.Wai.Middleware.RequestLogger
import Network.Wai.Handler.Warp

logOauth :: Application -> Application
logOauth = logStdoutDev

someFunc :: IO ()
someFunc = run 8000 (logOauth router)
