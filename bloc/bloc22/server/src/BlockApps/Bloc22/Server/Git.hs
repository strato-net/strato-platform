module BlockApps.Bloc22.Server.Git where

import           BlockApps.Bloc22.API.Git

getGitInfo :: Monad m => m GitInfo
getGitInfo = return gitInfo
