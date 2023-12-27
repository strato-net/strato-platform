{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE StandaloneDeriving #-}

module Versioning
  ( gitBranchMonostrato,
    gitHashMonostrato,
  )
where

import Control.Exception
import Control.Monad
--import           Control.Monad.IO.Class
import Data.Aeson
--import qualified Data.ByteString.Char8      as BS
import Data.Maybe
import GHC.Generics
import Language.Haskell.TH
import Language.Haskell.TH.Syntax
import System.Directory
import System.Exit
import System.FilePath
import System.Process

--import qualified Data.Yaml                  as Y

data StackRepo = StackRepo {package :: Package} deriving (Show, Generic)

data Package = Package {location :: String} deriving (Show, Generic)

instance FromJSON StackRepo

instance ToJSON StackRepo

instance FromJSON Package

instance ToJSON Package

{-
-- swap liftIO for runIO to use TH
getStackInfo :: Q String
getStackInfo = runIO $ do
      pwd' <- getCurrentDirectory
      setCurrentDirectory $ pwd' </> ".."
      liftIO $ do
        stackRef <- readFile ("stack.yaml" :: String)
        let parsedContent = Y.decodeEither' . BS.pack $ stackRef :: Either Y.ParseException [StackRepo]
        case parsedContent of
          Left err -> return $ "Could not parse stack config file:" ++ show err
          Right r -> return . show . toJSON $ r
-}

-- | Run git with the given arguments and no stdin, returning the
-- stdout output. If git isn't available or something goes wrong,
-- return the second argument.
-- This function is by Adam C. Foltzer, see https://hackage.haskell.org/package/gitrev
runGit :: [String] -> String -> Q String
runGit args def = do
  let oops :: SomeException -> IO (ExitCode, String, String)
      oops _e = return (ExitFailure 1, def, "")
  gitFound <- runIO $ isJust <$> findExecutable "git"
  if gitFound
    then do
      -- a lot of bookkeeping to record the right dependencies
      pwd <- runIO getCurrentDirectory

      let hd = pwd </> ".git" </> "HEAD"
          index = pwd </> ".git" </> "index"
          packedRefs = pwd </> ".git" </> "packed-refs"
      hdExists <- runIO $ doesFileExist hd
      when hdExists $ do
        -- the HEAD file either contains the hash of a detached head
        -- or a pointer to the file that contains the hash of the head
        hdRef <- runIO $ readFile hd
        case splitAt 5 hdRef of
          -- pointer to ref
          ("ref: ", relRef) -> do
            let ref = pwd </> ".git" </> relRef
            refExists <- runIO $ doesFileExist ref
            when refExists $ addDependentFile ref
          -- detached head
          _hash -> addDependentFile hd
      -- add the index if it exists to set the dirty flag
      indexExists <- runIO $ doesFileExist index
      when indexExists $ addDependentFile index
      -- if the refs have been packed, the info we're looking for
      -- might be in that file rather than the one-file-per-ref case
      -- handled above
      packedExists <- runIO $ doesFileExist packedRefs
      when packedExists $ addDependentFile packedRefs
      runIO $ do
        (code, out, _err) <- readProcessWithExitCode "git" args "" `catch` oops
        case code of
          ExitSuccess -> return (takeWhile (/= '\n') out)
          ExitFailure _ -> return def
    else return def

{-
mkFuncs :: [String] -> Q [Dec]
mkFuncs srt = return decs
    where dec n s = ValD (VarP n) (NormalB (LitE (StringL s))) []
          srt' = map (\x -> (mkName x, x)) srt
          decs = map (\(n,s) -> dec n s) srt'

stackYaml :: ExpQ
stackYaml = stringE =<< (getStackInfo)
-}

gitBranchMonostrato :: ExpQ
gitBranchMonostrato = stringE =<< runGit ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitHashMonostrato :: ExpQ
gitHashMonostrato = stringE =<< runGit ["rev-parse", "HEAD"] "no version found"
