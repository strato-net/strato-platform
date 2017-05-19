module BlockApps.Bloc20.Server.Git where

import           BlockApps.Bloc20.API.Git

getGitInfo :: Monad m => m GitInfo
getGitInfo = return gitInfo
