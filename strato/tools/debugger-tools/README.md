# debugger-tools

[![BlockApps logo](http://blockapps.net/img/logo_cropped.png)](http://blockapps.net)


This package contains tools to debug STRATO using ghc-debug.

To setup ghc-debug, modify the `main` of the program that you are trying to run as follows:
```
import GHC.Debug.Stub

main = withGhcDebug normalMain
```
This will create a socket to the program that ghc-debug will connect to.

Also, pass in the environment variable `GHC_DEBUG_SOCKET="/tmp/ghc-debug"` to your application inside `doit.sh`.

Example: `GHC_DEBUG_SOCKET="/tmp/ghc-debug" runBackgroundProcess strato-api  --minLogLevel=$apiDebugMode +RTS -N1 >> logs/strato-api 2>&1 `

Note: This does not work when built with profiling. `-hT` and `hi` will still work.

To use debugger-tools in a docker container, run the following commands:
`docker exec -it strato-strato-1 ghc-debug`
