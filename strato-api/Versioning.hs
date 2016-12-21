--{-# LANGUAGE TypeHoles #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE StandaloneDeriving #-}

module Versioning where

import Import hiding ((</>), readFile, def, index)

import qualified Prelude as P

import Language.Haskell.TH
import Language.Haskell.TH.Syntax
import System.Directory
import System.Exit
import System.FilePath
import System.Process
import qualified Data.ByteString.Char8 as BS

import qualified Data.Yaml as Y
--import Stack.Types.Config

-- packages:
-- - local-package
-- - location: vendor/binary
--   valid-wanted: false
-- - location:
--     git: git@github.com:yesodweb/wai
--     commit: 2f8a8e1b771829f4a8a77c0111352ce45a14c30f
--   subdirs:
--   - auto-update
--   - wai

data StackRepo = StackRepo { package :: Package } deriving (Show, Generic)
data Package = Package {location :: String} deriving (Show, Generic)

instance FromJSON StackRepo
instance ToJSON StackRepo
instance FromJSON Package
instance ToJSON Package

-- deriving instance Generic Config
-- instance FromJSON Config
-- instance ToJSON   Config

-- deriving instance Generic EnvSettings
-- instance FromJSON EnvSettings
-- instance ToJSON   EnvSettings

-- deriving instance Generic PackageIndex
-- instance FromJSON PackageIndex
-- instance ToJSON   PackageIndex

-- deriving instance Generic IndexLocation
-- instance FromJSON IndexLocation
-- instance ToJSON   IndexLocation

-- swap liftIO for runIO to use TH
getStackInfo :: Q String
getStackInfo = runIO $ do
      pwd' <- getCurrentDirectory
      setCurrentDirectory $ pwd' </> ".."
      --let pwd = pwd' </> ".."
      --stackExists  <- doesFileExist stackFilename
      --when stackExists
      liftIO $ do
        stackRef <- P.readFile ("stack.yaml" :: String)
        let parsedContent = Y.decode $ BS.pack $ stackRef :: Maybe [StackRepo]
        case parsedContent of
          Nothing -> return $ ("Could not parse stack config file." :: String)
          (Just r) -> return (show . toJSON $ (r))
          --(Just r@p) -> return (show . toJSON $ (configPackageIndices r))
          --(Just r@p) -> return (Versioning.location $ package r)
      --return ("bla" :: String)

-- | Run git with the given arguments and no stdin, returning the
-- stdout output. If git isn't available or something goes wrong,
-- return the second argument.
-- This function is by Adam C. Foltzer, see https://hackage.haskell.org/package/gitrev
runGit :: String -> [String] -> String -> Q String
runGit mydir args def = do
  let oops :: SomeException -> IO (ExitCode, String, String)
      oops _e = return (ExitFailure 1, def, "")
  gitFound <- runIO $ isJust <$> findExecutable "git"
  if gitFound
    then do
      -- a lot of bookkeeping to record the right dependencies
      pwd' <- runIO getCurrentDirectory
      runIO $ setCurrentDirectory $ pwd' </> ".." </> mydir
      let pwd = pwd' </> ".." </> mydir

      let hd         = pwd </> ".git" </> "HEAD"
          index      = pwd </> ".git" </> "index"
          packedRefs = pwd </> ".git" </> "packed-refs"
      hdExists  <- runIO $ doesFileExist hd
      when hdExists $ do
        -- the HEAD file either contains the hash of a detached head
        -- or a pointer to the file that contains the hash of the head
        hdRef <- runIO $ P.readFile hd
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
        setCurrentDirectory $ pwd' </> ".." </> mydir
        (code, out, _err) <- readProcessWithExitCode "git" args "" `catch` oops
        case code of
          ExitSuccess   -> return (takeWhile (/= '\n') out)
          ExitFailure _ -> return def
    else return def

mkFuncs :: [String] -> Q [Dec]
mkFuncs srt = return decs
    where dec n s = ValD (VarP n) (NormalB (LitE (StringL s))) []
          srt' = map (\x -> (mkName x, x)) srt
          decs = map (\(n,s) -> dec n s) srt'

stackYaml :: ExpQ
stackYaml = stringE =<< (getStackInfo)

gitBranchHServerEth :: ExpQ
gitBranchHServerEth =
  stringE =<< runGit "strato-api" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchEthereumVm :: ExpQ
gitBranchEthereumVm =
  stringE =<< runGit "ethereum-vm" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchEthereumClientHaskell :: ExpQ
gitBranchEthereumClientHaskell =
  stringE =<< runGit "strato-p2p-client" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchEthereumDataSql :: ExpQ
gitBranchEthereumDataSql =
  stringE =<< runGit "blockapps-data" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchHminer :: ExpQ
gitBranchHminer =
  stringE =<< runGit "miner-ethash" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchP2pServer :: ExpQ
gitBranchP2pServer =
  stringE =<< runGit "strato-p2p-server" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchEthereumUtil :: ExpQ
gitBranchEthereumUtil =
  stringE =<< runGit "blockapps-util" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchEthereumEncryption :: ExpQ
gitBranchEthereumEncryption =
  stringE =<< runGit "ethereum-encryption" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchEthereumMerklePatriciaDb :: ExpQ
gitBranchEthereumMerklePatriciaDb =
  stringE =<< runGit "merkle-patricia-db" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchEthereumQuery :: ExpQ
gitBranchEthereumQuery =
  stringE =<< runGit "blockapps-tools" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitBranchEthereumRlp :: ExpQ
gitBranchEthereumRlp =
  stringE =<< runGit "ethereum-rlp" ["rev-parse", "--abbrev-ref", "HEAD"] "no branch found"

gitHashEthereumClientHaskell :: ExpQ
gitHashEthereumClientHaskell = stringE =<< runGit "strato-p2p-client" ["rev-parse", "HEAD"] "no version found"

gitHashEthereumDataSql :: ExpQ
gitHashEthereumDataSql = stringE =<< runGit "blockapps-data" ["rev-parse", "HEAD"] "no version found"

gitHashEthereumEncryption :: ExpQ
gitHashEthereumEncryption = stringE =<< runGit "ethereum-encryption" ["rev-parse", "HEAD"] "no version found"

gitHashEthereumMerklePatriciaDb :: ExpQ
gitHashEthereumMerklePatriciaDb = stringE =<< runGit "merkle-patricia-db" ["rev-parse", "HEAD"] "no version found"

gitHashEthereumQuery :: ExpQ
gitHashEthereumQuery = stringE =<< runGit "blockapps-tools" ["rev-parse", "HEAD"] "no version found"

gitHashEthereumRlp :: ExpQ
gitHashEthereumRlp = stringE =<< runGit "ethereum-rlp" ["rev-parse", "HEAD"] "no version found"

gitHashEthereumUtil :: ExpQ
gitHashEthereumUtil = stringE =<< runGit "blockapps-util" ["rev-parse", "HEAD"] "no version found"

gitHashEthereumVm :: ExpQ
gitHashEthereumVm = stringE =<< runGit "ethereum-vm" ["rev-parse", "HEAD"] "no version found"

gitHashHminer :: ExpQ
gitHashHminer = stringE =<< runGit "miner-ethash" ["rev-parse", "HEAD"] "no version found"

gitHashHserverEth :: ExpQ
gitHashHserverEth = stringE =<< runGit "strato-api" ["rev-parse", "HEAD"] "no version found"

gitHashP2pServer :: ExpQ
gitHashP2pServer = stringE =<< runGit "strato-p2p-server" ["rev-parse", "HEAD"] "no version found"
