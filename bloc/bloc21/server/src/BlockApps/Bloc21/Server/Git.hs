module BlockApps.Bloc21.Server.Git where

import           BlockApps.Bloc21.API.Git
import           BlockApps.Bloc21.Monad

getGitInfo :: Bloc GitInfo
getGitInfo = return gitInfo
