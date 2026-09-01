module Main (main) where

import Distribution.Simple
import Distribution.Simple.LocalBuildInfo (buildDir, flagAssignment)
import Distribution.Simple.Setup (ConfigFlags (configConfigurationsFlags, configExtraLibDirs, configExtraLibDirsStatic))
import Distribution.Types.Flag (FlagAssignment, lookupFlagAssignment, mkFlagName)
import System.Directory (copyFile, createDirectoryIfMissing, makeAbsolute, withCurrentDirectory)
import System.FilePath ((</>))
import System.Process (callProcess)

main :: IO ()
main = defaultMainWithHooks hooks
  where
    hooks =
      simpleUserHooks
        { confHook = \packageDescription flags -> do
            if nativeBn254Enabled (configConfigurationsFlags flags)
              then do
                nativeLibraryDirectory <- prepareNative
                confHook
                  simpleUserHooks
                  packageDescription
                  flags
                    { configExtraLibDirs = nativeLibraryDirectory : configExtraLibDirs flags,
                      configExtraLibDirsStatic = nativeLibraryDirectory : configExtraLibDirsStatic flags
                    }
              else confHook simpleUserHooks packageDescription flags,
          buildHook = \packageDescription localBuildInfo userHooks flags -> do
            if nativeBn254Enabled (flagAssignment localBuildInfo)
              then do
                _ <- prepareNative
                createDirectoryIfMissing True $ buildDir localBuildInfo
                copyFile nativeLibrary (buildDir localBuildInfo </> "libCsolid_vm_native.a")
              else pure ()
            buildHook simpleUserHooks packageDescription localBuildInfo userHooks flags
        }

nativeBn254Enabled :: FlagAssignment -> Bool
nativeBn254Enabled flags = lookupFlagAssignment (mkFlagName "native-bn254") flags == Just True

prepareNative :: IO FilePath
prepareNative = do
  buildNative
  nativeLibraryDirectory <- makeAbsolute $ "native" </> "target" </> "release"
  copyFile nativeLibrary (nativeLibraryDirectory </> "libCsolid_vm_native.a")
  pure nativeLibraryDirectory

buildNative :: IO ()
buildNative =
  withCurrentDirectory "native" $
    callProcess
      "cargo"
      [ "build",
        "--release",
        "--locked"
      ]

nativeLibrary :: FilePath
nativeLibrary = "native" </> "target" </> "release" </> "libsolid_vm_native.a"
