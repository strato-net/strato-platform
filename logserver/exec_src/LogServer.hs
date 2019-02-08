{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Blaze.ByteString.Builder
import Control.Monad
import qualified Data.Aeson.Encode.Pretty as Ae
import qualified Data.Map as M
import qualified Data.Text as T
import HFlags
import Network.Wai.Application.Static
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import Network.Wai.Middleware.RequestLogger
import WaiAppStatic.Types

defineFlag "d:directory" ("/var/lib/strato/logs" :: String) "Directory to serve the files from"
defineFlag "u:uri_root" ("/strato/logs/" :: T.Text) "Prefix to add in front of any URIs"
$(return [])

jsonList :: Pieces -> Folder -> IO Builder
jsonList pieces (Folder elems) = do
  -- TODO(tim): These pieces maybe should be used as a prefix for the URIs
  print pieces
  return . fromLazyByteString . Ae.encodePretty . map (either renderFolder renderFile) $ elems
  where renderFolder :: FolderName -> M.Map T.Text T.Text
        renderFolder dirname = M.fromList
           [ ("type", "directory")
           , ("name", fromPiece dirname)
           , ("uri",  flags_uri_root <> fromPiece dirname)
           ]

        renderFile :: File -> M.Map T.Text T.Text
        renderFile file = M.fromList
          [ ("type", "file")
          , ("name", fromPiece $ fileName file)
          , ("uri", flags_uri_root <> fromPiece (fileName file))
          , ("size", T.pack . show . fileGetSize $ file)
          ]

main :: IO ()
main = do
  unknown <- $initHFlags "Strato Log Server"
  unless (null unknown) . putStrLn $ "Unknown flags: " ++ show unknown
  let settings = defaultFileServerSettings flags_directory
      rawApp = staticApp settings
             { ssGetMimeType = const (return "application/json")
             , ssListing = Just jsonList
             }
      app = prometheus def . logStdoutDev $ rawApp
  putStrLn $ "Serving directory " ++ flags_directory
  run 7065 app
