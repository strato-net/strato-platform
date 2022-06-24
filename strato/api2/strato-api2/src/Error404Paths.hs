{-# LANGUAGE OverloadedStrings #-}

{-# OPTIONS -fno-warn-orphans #-}

module Error404Paths where

import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8      as BLC
import qualified Data.HashMap.Strict.InsOrd      as H
import           Data.Proxy
import           Data.Swagger
import           Network.HTTP.Types.Status
import           Network.Wai
import           Servant.Swagger

import           API
import           Text.Tools


addPathsTo404 :: Middleware
addPathsTo404 baseApp req respond =
  baseApp req $ \response -> do
    if responseStatus response /= status404
    then respond response
    else 
      respond $ responseLBS notFound404 [("Content-Type", "text/plain")] $ BLC.pack
        $ "There is no content at: " ++ show (rawPathInfo req)
        ++ "\nHere are the available routes:" ++ tab ("\n" ++ unlines allPaths) ++ "\n"
      where
        allPaths = H.keys $ _swaggerPaths $ toSwagger (Proxy :: Proxy API)



instance ToSchema Value where
  declareNamedSchema _ = return $
    NamedSchema (Just "JSON Value") mempty
