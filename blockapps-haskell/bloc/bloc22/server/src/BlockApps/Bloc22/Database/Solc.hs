{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE RecordWildCards #-}

module BlockApps.Bloc22.Database.Solc where

import           Control.Monad              hiding (mapM_)
import           Data.Aeson hiding (String)
import Data.Monoid ((<>))
import qualified Data.List                  as List
import           Data.Map                   ()
import qualified Data.Map                   as Map
import           Data.Text
import qualified Data.Text                  as Text
import qualified Data.Traversable           as Trv
import           Control.Monad.IO.Class     (MonadIO(..))

import           Control.Monad.Trans.Either
import           System.IO.Temp
import           System.Directory
import           System.Exit
import           System.FilePath
import           System.IO                  as IO
import           System.Process

import           Data.Map.Strict
import qualified Data.Aeson                 as Aeson
import qualified Data.ByteString.Lazy       as BL
import qualified Data.Text.Encoding         as Text

import BlockApps.Bloc22.Monad
import BlockApps.Solidity.Parse.Parser
import BlockApps.Solidity.Parse.ParserTypes
import BlockApps.Solidity.Parse.UnParser


-- Query parameters allowed:
--   src: solidity source code to be compiled, as a (url-encoded) string
--   optimize, add-std, link: flags for "solc" executable
--   optimize-runs, libraries: options with arguments for "solc" executable
-- Data allowed:
--   main: a Solidity source file to be compiled
--   import: a Solidity source file that is included by another one
-- Response:
--   { <contract name> : { abi : <solidity contract abi>, bin : <hex string> } }


-- This is really hard to understand and highly non-idomatic for json formation or parsing.
-- It was basically copy/pasted directly from strato-api for expediency, someone should really fix
-- this if it is something we want to maintain.
compileSolc :: Text -> Bloc Aeson.Value
compileSolc mainSrc = do
  (postParams, mainFiles, importFiles) <- getSolSrc mainSrc
  eRes <- liftIO . runEitherT $ runSolc postParams mainFiles importFiles
  case eRes of
    Left (err, ExitFailure 1) -> blocError . UserError . Text.pack $ err
    Left (err,_) -> blocError . AnError . Text.pack $ err
    Right res ->
      maybe (blocError . AnError $ "SolcError : No \"src\" field in json artifact")
            return $ Map.lookup "src" res


-- For solc compiling during testing, outside of Bloc monad
compileSolcIO :: Text -> IO (Either String Aeson.Value)
compileSolcIO mainSrc = do
  (postParams, mainFiles, importFiles) <- getSolSrc mainSrc
  eRes <- liftIO . runEitherT $ runSolc postParams mainFiles importFiles
  return $ case eRes of
    Left (err, ExitFailure 1) -> Left err
    Left (err,_) -> Left err
    Right res ->
      maybe (Left $ "SolcError : No \"src\" field in json artifact") Right $ Map.lookup "src" res

runSolc :: Map String String
        -> Map String String
        -> Map String String
        -> EitherT (String, ExitCode) IO (Map String Aeson.Value)
runSolc optsObj mainSrc importsSrc =
  execSolc solcCompileOpts solcLinkOpts mainSrc importsSrc
  where
    solcCompileOpts = List.concat [
      solcOParam, solcORunsParam, solcStdParam, ["--combined-json=abi,bin,bin-runtime", "--evm-version=homestead"]
      ]
    solcLinkOpts = List.concat [solcLinkParam, solcLibsParam]

    solcOParam = optNoArg "optimize" optsObj
    solcORunsParam = optWithArg "optimize-runs" optsObj
    solcStdParam = optNoArg "add-std" optsObj

    solcLinkParam = optNoArg "link" optsObj
    solcLibsParam = optWithArg "libraries" optsObj



execSolc :: [String] -> [String] -> Map String String -> Map String String
            -> EitherT (String, ExitCode) IO (Map String Aeson.Value)
execSolc compileOpts linkOpts mainSrc importsSrc =
  doWithEitherT withTempDir $ \dir -> do
    bimapEitherT (\x -> (x,ExitFailure 0)) id $ makeSrcFiles dir $ Map.union mainSrc importsSrc
    compiledFiles <- Trv.sequence $ Map.mapWithKey (const . solcFile compileOpts linkOpts dir) mainSrc
    return $ Map.filter
      (\file -> case file of
          Aeson.Null -> False
          _          -> True)
      compiledFiles

solcFile :: [String] -> [String] -> String -> String -> EitherT (String, ExitCode) IO Aeson.Value
solcFile compileOpts linkOpts dir fileName = do
  solcOutput <- callSolc compileOpts dir fileName
  solcJSON0 <- hoistEither $ aesonDecodeUtf8 $ Text.pack solcOutput
  let solcJSON1 = Map.lookup ("contracts" :: String) solcJSON0

  let nullOutput n = liftM $ either (maybe (Right n) Left) Right
  mapEitherT (nullOutput $ Aeson.Null) $ do
    solcJSON :: Map String (Map String Aeson.Value) <-
      case Aeson.fromJSON <$> solcJSON1 of
        Just (Aeson.Error err) -> left $ Just (err, ExitFailure 0)
        Just (Aeson.Success m) -> right m
        Nothing                -> left Nothing

    let linkBin binabi bin tag =
          if (not . List.null $ linkOpts)
          then do
            linkedBin <- bimapEitherT Just id $ callSolc linkOpts dir bin
            return $ Map.insert tag (Aeson.toJSON linkedBin) binabi
          else return binabi

    linkJSON <- Trv.forM solcJSON $ \binabi ->
      bimapEitherT Just id $ mapEitherT (nullOutput Map.empty) $ do
        let lookupTag tag = case Aeson.fromJSON <$> Map.lookup tag binabi of
              Just (Aeson.Error err)  -> left $ Just (err, ExitFailure 0)
              Just (Aeson.Success "") -> left Nothing
              Just (Aeson.Success s)  -> right s
              Nothing                 -> left Nothing
        bin <- lookupTag "bin"
        binabiL <- linkBin binabi bin "bin"
        binr <- lookupTag "bin-runtime"
        linkBin binabiL binr "bin-runtime"

    return $ Aeson.toJSON $ Map.filter (not . Map.null) linkJSON

callSolc :: [String] -> String -> String -> EitherT (String, ExitCode) IO String
callSolc opts dir fileName =
  let solcCmd = (proc "solc" $ opts ++ [fileName]){ cwd = Just dir }
  in execWithEitherT $ readCreateProcessWithExitCode solcCmd ""

makeSrcFiles :: String -> Map String String -> EitherT String IO ()
makeSrcFiles dir filesSrc = do
  let ensureRelative path =
        if isRelative path
        then right path
        else left $ "Refusing to handle absolute file path: " List.++ path
  dirs <- mapM ensureRelative $ List.nub $ List.map takeDirectory $ Map.keys filesSrc
  liftIO $ do
    mapM_ (createDirectoryIfMissing True) $ List.map (dir </>) dirs
    Map.foldrWithKey (\k s x -> IO.writeFile (dir </> k) s >> x) (return ()) filesSrc

doWithEitherT :: ((String -> IO (Either c d)) -> IO (Either c e)) -> ((String -> EitherT c IO d) -> EitherT c IO e)
doWithEitherT runner cmd = do
  let cmdIO = runEitherT . cmd
  resultE <- liftIO $ runner cmdIO
  hoistEither resultE

execWithEitherT :: IO (ExitCode, String, String) -> EitherT (String,ExitCode) IO String
execWithEitherT op = do
  (exitCode, stdOut, stdErr) <- liftIO op
  case exitCode of
    ExitSuccess -> right stdOut
    _           -> left (stdErr,exitCode)

withTempDir :: (String -> IO a) -> IO a
withTempDir act = withSystemTempDirectory "solc" act

optNoArg :: String -> Map String String -> [String]
optNoArg opt opts =
  maybe [] (const ["--" ++ opt]) $ Map.lookup opt opts

optWithArg :: String -> Map String String -> [String]
optWithArg opt opts =
  maybe [] (\arg -> ["--" ++ opt, arg]) $ Map.lookup opt opts

aesonDecodeUtf8 :: (FromJSON a) => Text -> Either (String, ExitCode) a
aesonDecodeUtf8 x = case Aeson.eitherDecode . BL.fromStrict . Text.encodeUtf8 $ x of
  Left err -> Left (err,ExitFailure 0)
  Right y -> Right y

getSolSrc :: MonadIO m => Text -> m (Map String String, Map String String, Map String String)
getSolSrc src = return (mempty, Map.singleton "src" (Text.unpack src), mempty)
--  (postParamsAssoc, postFilesAssoc) <- runRequestBody
--  let postParams = Map.fromList $
--                   map (\(x,y) -> (Text.unpack x, Text.unpack y))
--                   postParamsAssoc
--      postFilesInfo =
--        Map.fromList $
--        map (\l -> (P.fst $ P.head l, Map.fromList $ map P.snd l)) $
--        List.groupBy ((==) `on` fst) $
--        map (\(a, b) ->
--          let (a1, a2) = List.break (== ':') $ Text.unpack a
--              a3 = maybe a2 id $ stripPrefix ":" a2
--          in (a1, (a3, b))
--          ) $
--        postFilesAssoc
--  mainFiles0 <- maybe (return Map.empty) getFileContents $
--                Map.lookup "main" postFilesInfo
--  importFiles <- maybe (return Map.empty) getFileContents $
--                 Map.lookup "import" postFilesInfo
--  let mainFiles = maybe mainFiles0 (\s -> Map.insert "src" s mainFiles0) $
--                  Map.lookup "src" postParams
--  return (postParams, mainFiles, importFiles)


addGetSourceFuncToSource :: Text -> Either String Text
addGetSourceFuncToSource src = do
  -- Supply empty string for parser as it's only used for error reporting
  File units <- parseXabiNoInheritanceMerge "" (unpack src)
  let src' = formatSrc src
      addGetSource (NamedXabi name (xabi, ts)) = NamedXabi name (addF src' xabi, ts)
      addGetSource prag = prag
      modifiedContents = List.map addGetSource units
  return . pack . unparse . File $ modifiedContents
  where
    addF s = addFunction ("__getSource__", "return \"" <> unpack s <> "\";  ")
    formatSrc = replace "\"" "\\\""
              . replace "\n" "\\n"
              . replace "'" "\\'"

-- TODO: Merge with addGetSourceFunc if stable
addGetNameFuncToSource :: Text -> Either String Text
addGetNameFuncToSource src = do
  File units <- parseXabiNoInheritanceMerge "" (unpack src)
  let addGetName (NamedXabi name (xabi, ts)) = NamedXabi name (
          addFunction ("__getContractName__", "return \"" <> unpack name <> "\";") xabi, ts)
      addGetName prag = prag
  return . pack . unparse . File . List.map addGetName $ units

stripLines :: Text -> Text
stripLines = Text.concat . Text.lines
