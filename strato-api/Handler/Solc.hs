{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Handler.Solc (postSolcR) where

import           Control.Monad              hiding (mapM_)
import           Control.Monad.Trans.Either
import qualified Data.Aeson                 as Aeson
import qualified Data.List                  as List
import           Data.Map                   ()
import qualified Data.Map                   as Map
import qualified Data.Text                  as Text
import qualified Data.Traversable           as Trv

import           Handler.SolidityCommon
import           Import

import           System.Directory
import           System.Exit
import           System.FilePath
import           System.IO                  as IO
import           System.IO.Temp
import           System.Process

-- Query parameters allowed:
--   src: solidity source code to be compiled, as a (url-encoded) string
--   optimize, add-std, link: flags for "solc" executable
--   optimize-runs, libraries: options with arguments for "solc" executable
-- Data allowed:
--   main: a Solidity source file to be compiled
--   import: a Solidity source file that is included by another one
-- Response:
--   { <contract name> : { abi : <solidity contract abi>, bin : <hex string> } }

postSolcR :: Handler Text
postSolcR = do
  addHeader "Access-Control-Allow-Origin" "*"
  (postParams, mainFiles, importFiles) <- getSolSrc
  eitherErrEncode $ runSolc postParams mainFiles importFiles

runSolc :: Map String String -> Map String String -> Map String String
           -> EitherT String IO (Map String Aeson.Value)
runSolc optsObj mainSrc importsSrc =
  execSolc solcCompileOpts solcLinkOpts mainSrc importsSrc
  where
    solcCompileOpts = concat [
      solcOParam, solcORunsParam, solcStdParam, ["--combined-json=abi,bin,bin-runtime"]
      ]
    solcLinkOpts = concat [solcLinkParam, solcLibsParam]

    solcOParam = optNoArg "optimize" optsObj
    solcORunsParam = optWithArg "optimize-runs" optsObj
    solcStdParam = optNoArg "add-std" optsObj

    solcLinkParam = optNoArg "link" optsObj
    solcLibsParam = optWithArg "libraries" optsObj

execSolc :: [String] -> [String] -> Map String String -> Map String String
            -> EitherT String IO (Map String Aeson.Value)
execSolc compileOpts linkOpts mainSrc importsSrc =
  doWithEitherT withTempDir $ \dir -> do
    makeSrcFiles dir $ Map.union mainSrc importsSrc
    compiledFiles <- Trv.sequence $ Map.mapWithKey (const . solcFile compileOpts linkOpts dir) mainSrc
    return $ Map.filter
      (\file -> case file of
          Aeson.Null -> False
          _          -> True)
      compiledFiles

solcFile :: [String] -> [String] -> String -> String -> EitherT String IO Aeson.Value
solcFile compileOpts linkOpts dir fileName = do
  solcOutput <- callSolc compileOpts dir fileName
  solcJSON0 <- hoistEither $ aesonDecodeUtf8 $ Text.pack solcOutput
  let solcJSON1 = Map.lookup ("contracts" :: String) solcJSON0

  let nullOutput n = liftM $ either (maybe (Right n) Left) Right
  mapEitherT (nullOutput $ Aeson.Null) $ do
    solcJSON :: Map String (Map String Aeson.Value) <-
      case Aeson.fromJSON <$> solcJSON1 of
        Just (Aeson.Error err) -> left $ Just err
        Just (Aeson.Success m) -> right m
        Nothing                -> left Nothing

    let linkBin binabi bin tag =
          if (not . null $ linkOpts)
          then do
            linkedBin <- bimapEitherT Just id $ callSolc linkOpts dir bin
            return $ Map.insert tag (Aeson.toJSON linkedBin) binabi
          else return binabi

    linkJSON <- Trv.forM solcJSON $ \binabi ->
      bimapEitherT Just id $ mapEitherT (nullOutput Map.empty) $ do
        let lookupTag tag = case Aeson.fromJSON <$> Map.lookup tag binabi of
              Just (Aeson.Error err)  -> left $ Just err
              Just (Aeson.Success "") -> left Nothing
              Just (Aeson.Success s)  -> right s
              Nothing                 -> left Nothing
        bin <- lookupTag "bin"
        binabiL <- linkBin binabi bin "bin"
        binr <- lookupTag "bin-runtime"
        linkBin binabiL binr "bin-runtime"

    return $ Aeson.toJSON $ Map.filter (not . Map.null) linkJSON

callSolc :: [String] -> String -> String -> EitherT String IO String
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

execWithEitherT :: IO (ExitCode, String, String) -> EitherT String IO String
execWithEitherT op = do
  (exitCode, stdOut, stdErr) <- liftIO op
  case exitCode of
    ExitSuccess -> right stdOut
    _           -> left stdErr

withTempDir :: (String -> IO a) -> IO a
withTempDir act = withSystemTempDirectory "solc" act

optNoArg :: String -> Map String String -> [String]
optNoArg opt opts =
  maybe [] (const ["--" ++ opt]) $ Map.lookup opt opts

optWithArg :: String -> Map String String -> [String]
optWithArg opt opts =
  maybe [] (\arg -> ["--" ++ opt, arg]) $ Map.lookup opt opts
