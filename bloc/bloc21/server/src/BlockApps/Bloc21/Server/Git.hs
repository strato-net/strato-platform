module BlockApps.Bloc21.Server.Git where

import           BlockApps.Bloc21.API.Git

getGitInfo :: Monad m => m GitInfo
getGitInfo = return gitInfo
