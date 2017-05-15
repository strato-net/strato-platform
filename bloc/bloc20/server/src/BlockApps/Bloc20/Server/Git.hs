module BlockApps.Bloc20.Server.Git where

import           BlockApps.Bloc20.API.Git
import           BlockApps.Bloc20.Monad

getGitInfo :: Bloc GitInfo
getGitInfo = return gitInfo
