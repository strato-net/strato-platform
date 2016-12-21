module Handler.SolidityCommon where

import Control.Monad.Trans.Either
import qualified Data.Aeson as Aeson
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString as BS
import Data.Conduit
import Data.Conduit.List (consume)
import qualified Data.List as List
import qualified Data.Map as Map
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import qualified Data.Traversable as Trv

import Import
import qualified Prelude as P

aesonEncodeUtf8 :: (ToJSON a) => a -> Text
aesonEncodeUtf8 = Text.decodeUtf8 . BL.toStrict . Aeson.encode

aesonDecodeUtf8 :: (FromJSON a) => Text -> Either String a
aesonDecodeUtf8 = Aeson.eitherDecode . BL.fromStrict . Text.encodeUtf8

eitherErrEncode :: (ToJSON a) => EitherT String IO a -> Handler Text
eitherErrEncode eT = do
  e <- liftIO $ runEitherT eT
  either
    (\err -> invalidArgs [makeError err])
    (return . aesonEncodeUtf8)
    e
  where
    makeError err = aesonEncodeUtf8 $ Aeson.object [("error",toJSON err)]

getSolSrc :: Handler (Map String String, Map String String, Map String String)
getSolSrc = do
  (postParamsAssoc, postFilesAssoc) <- runRequestBody
  let postParams = Map.fromList $
                   map (\(x,y) -> (Text.unpack x, Text.unpack y))
                   postParamsAssoc
      postFilesInfo =
        Map.fromList $
        map (\l -> (P.fst $ P.head l, Map.fromList $ map P.snd l)) $
        List.groupBy ((==) `on` fst) $
        map (\(a, b) ->
          let (a1, a2) = List.break (== ':') $ Text.unpack a
              a3 = maybe a2 id $ stripPrefix ":" a2
          in (a1, (a3, b))
          ) $
        postFilesAssoc
  mainFiles0 <- maybe (return Map.empty) getFileContents $
                Map.lookup "main" postFilesInfo
  importFiles <- maybe (return Map.empty) getFileContents $
                 Map.lookup "import" postFilesInfo
  let mainFiles = maybe mainFiles0 (\s -> Map.insert "src" s mainFiles0) $
                  Map.lookup "src" postParams
  return (postParams, mainFiles, importFiles)

getFileContents :: Map String FileInfo -> Handler (Map String String)
getFileContents = Trv.mapM fileInfoToString

fileInfoToString :: FileInfo -> Handler String
fileInfoToString fileInfo = do
  fileContentsChunks <- fileSource fileInfo $$ consume
  return $ Text.unpack $ Text.decodeUtf8 $ BS.concat fileContentsChunks

