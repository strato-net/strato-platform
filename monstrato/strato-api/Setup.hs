module Main where
import           Distribution.PackageDescription
import           Distribution.Simple
import           Distribution.Simple.LocalBuildInfo
import           Distribution.Simple.Setup
import           System.Process                     (runCommand, waitForProcess)

main :: IO ()
main = defaultMainWithHooks $ simpleUserHooks
         { preBuild = genTests }

genTests :: Args -> BuildFlags -> IO HookedBuildInfo
genTests _ _ = do
  --putStrLn "Running tests"
  --waitForProcess =<< runCommand "cabal test --show-details=streaming --verbose=1 | grep '<' > static/testreport.html"
  return emptyHookedBuildInfo
