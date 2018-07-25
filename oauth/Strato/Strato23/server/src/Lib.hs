module Lib
    ( someFunc
    ) where

import Strato.Strato23.Server (router)
import Network.Wai.Handler.Warp

someFunc :: IO ()
someFunc = run 8000 router
