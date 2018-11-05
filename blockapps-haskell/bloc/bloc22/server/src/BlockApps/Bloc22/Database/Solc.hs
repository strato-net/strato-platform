{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE RecordWildCards #-}

module BlockApps.Bloc22.Database.Solc where

import           Control.Monad              hiding (mapM_)
import           Control.Monad.IO.Class     (MonadIO(..))
import           Control.Monad.Trans.Except
import           Data.Aeson hiding (String)
import qualified Data.List                  as List
import           Data.Map                   ()
import qualified Data.Map                   as Map
import           Data.Text
import qualified Data.Text                  as Text
import qualified Data.Traversable           as Trv
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
  eRes <- liftIO . runExceptT $ runSolc postParams mainFiles importFiles
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
  eRes <- liftIO . runExceptT $ runSolc postParams mainFiles importFiles
  return $ case eRes of
    Left (err, ExitFailure 1) -> Left err
    Left (err,_) -> Left err
    Right res ->
      maybe (Left $ "SolcError : No \"src\" field in json artifact") Right $ Map.lookup "src" res

runSolc :: Map String String
        -> Map String String
        -> Map String String
        -> ExceptT (String, ExitCode) IO (Map String Aeson.Value)
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
            -> ExceptT (String, ExitCode) IO (Map String Aeson.Value)
execSolc compileOpts linkOpts mainSrc importsSrc =
  doWithExceptT withTempDir $ \dir -> do
    withExceptT (\e -> (e,ExitFailure 0)) $ makeSrcFiles dir $ Map.union mainSrc importsSrc
    compiledFiles <- Trv.sequence $ Map.mapWithKey (const . solcFile compileOpts linkOpts dir) mainSrc
    return $ Map.filter
      (\file -> case file of
          Aeson.Null -> False
          _          -> True)
      compiledFiles

solcFile :: [String] -> [String] -> String -> String -> ExceptT (String, ExitCode) IO Aeson.Value
solcFile compileOpts linkOpts dir fileName = do
  solcOutput <- callSolc compileOpts dir fileName
  solcJSON0 <- ExceptT . return  . aesonDecodeUtf8 . Text.pack $ solcOutput
  let solcJSON1 = Map.lookup ("contracts" :: String) solcJSON0

  let nullOutput n = liftM $ either (maybe (Right n) Left) Right
  mapExceptT (nullOutput $ Aeson.Null) $ do
    solcJSON :: Map String (Map String Aeson.Value) <-
      case Aeson.fromJSON <$> solcJSON1 of
        Just (Aeson.Error err) -> throwE $ Just (err, ExitFailure 0)
        Just (Aeson.Success m) -> return m
        Nothing                -> throwE Nothing

    let linkBin binabi bin tag =
          if (not . List.null $ linkOpts)
          then do
            linkedBin <- withExceptT Just $ callSolc linkOpts dir bin
            return $ Map.insert tag (Aeson.toJSON linkedBin) binabi
          else return binabi

    linkJSON <- Trv.forM solcJSON $ \binabi ->
      withExceptT Just $ mapExceptT (nullOutput Map.empty) $ do
        let lookupTag tag = case Aeson.fromJSON <$> Map.lookup tag binabi of
              Just (Aeson.Error err)  -> throwE $ Just (err, ExitFailure 0)
              Just (Aeson.Success "") -> throwE Nothing
              Just (Aeson.Success s)  -> return s
              Nothing                 -> throwE Nothing
        bin <- lookupTag "bin"
        binabiL <- linkBin binabi bin "bin"
        binr <- lookupTag "bin-runtime"
        linkBin binabiL binr "bin-runtime"

    return $ Aeson.toJSON $ Map.filter (not . Map.null) linkJSON

callSolc :: [String] -> String -> String -> ExceptT (String, ExitCode) IO String
callSolc opts dir fileName =
  let solcCmd = (proc "solc" $ opts ++ [fileName]){ cwd = Just dir }
  in execWithExceptT $ readCreateProcessWithExitCode solcCmd ""

makeSrcFiles :: String -> Map String String -> ExceptT String IO ()
makeSrcFiles dir filesSrc = do
  let ensureRelative path =
        if isRelative path
        then return path
        else throwE $ "Refusing to handle absolute file path: " List.++ path
  dirs <- mapM ensureRelative $ List.nub $ List.map takeDirectory $ Map.keys filesSrc
  liftIO $ do
    mapM_ (createDirectoryIfMissing True) $ List.map (dir </>) dirs
    Map.foldrWithKey (\k s x -> IO.writeFile (dir </> k) s >> x) (return ()) filesSrc

doWithExceptT :: ((String -> IO (Either c d)) -> IO (Either c e)) -> ((String -> ExceptT c IO d) -> ExceptT c IO e)
doWithExceptT runner cmd = do
  let cmdIO = runExceptT . cmd
  resultE <- liftIO $ runner cmdIO
  ExceptT . return $ resultE

execWithExceptT :: IO (ExitCode, String, String) -> ExceptT (String,ExitCode) IO String
execWithExceptT op = do
  (exitCode, stdOut, stdErr) <- liftIO op
  case exitCode of
    ExitSuccess -> return stdOut
    _           -> throwE (stdErr,exitCode)

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
