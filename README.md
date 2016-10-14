# silo

This meta-meta repo provides the deployment framework for the `strato` product.
Its `mgitmods` tracks the various modules, some of which (i.e. `strato`) are
themselves meta-repos managed by `mgit`.

## Building

The build process as-of-yet has two stages: a one-time setup piece and an
incremental build piece.

### One-time setup

Run
```
./install deploybases (local|docker) [module-name ..]
```
to build the runtime dependencies for the modules.  If `local`, these
dependencies are installed directly on your machine; if `docker`, a set of
docker images is built.

This command only needs to be run again if one of the scripts
`<submod>/pkg/setup-deployment.sh` changes, which should be almost never.

### Building incrementally

After setting up the deploybases, run
```
./install (local|local-to-docker) [module-name ..]
```
to build all the modules (or just those named).  Currently, the build is always
performed using local-machine tools, and the difference between `local` and
`local-to-docker` is how the final deployment is done: either onto the local
machine, or into a set of docker images.  In the latter case, each image is
named after the submodule it contains.

This command is friendly to incremental builds in the sense that it never
removes build products.  Therefore, depending on the nature of the submodules'
build processes, successive builds may go more quickly than initial ones.  This
is true whether or not docker is used.

## Architecture

The build system has the following pieces:
1. The build-time dependency environment (currently unimplemented)
2. Building local sources
3. The runtime dependency environment
4. Creating the deployment from the build products.
These stages are controlled by scripts located in the `<submod>/pkg`
directories.

### Build-time dependencies

This has no support currently; we simply assume that all the necessary tools are
present on your machine.  If not, you'll get an error, which may not be
especially obvious.

### Building

This is controlled by the `<submod>/pkg/BUILD` script, which is provided with
some environment variables:
- `submod`: the name of the submodule
- `builddir`: the directory where all build products must be placed (this is
  always `<submod>/pkg/build`)
- `pkgdir`: the package directory, i.e. `<submod>/pkg`
It is not a good idea to rely on the actual values of these variables, though;
use them exclusively symbolically in the `BUILD` scripts.

### Runtime dependencies

This is controlled by the `<submod>/pkg/setup-deployment.sh` script, which for
`./install deploybases docker` is run inside a Dockerfile building on Ubuntu
16.04.  The purpose of this script is to install anything that is _not_ local
source or depends on it; e.g. Ubuntu packages, npm packages, and so on.  Nothing
that ever changes in our own repos should affect this script.

### Deployment

This is an entirely automatic process that simply copies, on top of the runtime
dependencies, the entire contents of `<submod>/pkg/build` (i.e. `$builddir`)
into the root filesystem, either of the local machine or a docker image under
construction.  The startup script for the submodule is `<submod>/pkg/doit.sh`,
which is set as the `ENTRYPOINT` of the docker image if `local-to-docker` is
used.

