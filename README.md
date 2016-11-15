# silo

This meta-meta repo provides the deployment framework for the `strato` product.
Its `mgitmods` tracks the various modules, some of which (i.e. `strato`) are
themselves meta-repos managed by `mgit`.

## Pre-build

To prepare a completely new (Ubuntu 16.04) machine to use this repo, you must run the
`bootstrap` script provided (to get it without cloning the repo, `wget` the
"Raw" file from github) with the desired branch of `silo`.  That is,
```
# wget https://raw.githubusercontent.com/blockapps/silo/132922485_transaction-batching/bootstrap?token=<something> -O bootstrap  
chmod +x bootstrap
./bootstrap <branch>
```
After this is complete, you will have the Haskell Stack and Docker installed and our repo
management tool `mgit` built and installed.

Once this is done you may fetch the entire `silo` meta-repo with
```
mgit clone https://github.com/blockapps/silo -b <branch>
```

## Building

The build process as-of-yet has two stages: a one-time setup piece and an
incremental build piece.

### One-time setup

Ideally, the build-time and deploy-time dependencies will be automatically
installed if they are not determined to be up-to-date (based on a timestamp
comparison between the installation script and a sentinel file).  If either of
these steps needs to be forced for some reason, the following commands are
available:
```
./install build-env local [module-name ..]
./install deploy-env (local|docker) [module-name ..]
```
If `local`, these dependencies are installed directly on your machine;
if `docker`, a set of docker images is built.  Currently we don't support
dockerized build environments.  In fact, the only OS we support is Ubuntu 16.04,
because of library versioning in the dependencies of `solc`.

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

Please note that any commands with `sudo` capacity will need to be added to the [blockapps-ci](https://github.com/blockapps/blockapps-ci/) `/etc/sudoers.d/go` as described the the [readme](https://github.com/blockapps/blockapps-ci/blob/master/README.md#go-agent). Currently these are 
```
/usr/bin/apt-get, /usr/bin/apt-key, /usr/sbin/usermod, /bin/su, /usr/bin/tee, /bin/bash, /usr/bin/docker
```

### Build-time dependencies

This is controlled by the `<submod>/pkg/setup-build.sh` script, which for
`./install build-env docker` is run inside a Dockerfile building on Ubuntu
16.04.  The purpose of this script is to install any programs or libraries
required during the build process; none of these should be part of our own
repos, and none of it should be copied directly to `$builddir`; use
`setup-deployment` for that.  You can and should use the `$sudo` variable to
indicate either `sudo` itself or the empty string, which is selected depending
on the build mode.

The Dockerfile for this is `buildDocker/Dockerfile-buildenv`.

### Building

This is controlled by the `<submod>/pkg/BUILD` script, which is provided with
some environment variables:
- `submod`: the name of the submodule
- `workdir`: the directory where work is done (`.silo-work/<submod>`)
- `builddir`: the directory where all build products must be placed (this is
  always `.silo-work/<submod>/build`)
- `pkgdir`: the package directory, i.e. `<submod>/pkg`
It is not a good idea to rely on the actual values of these variables, though;
use them exclusively symbolically in the `BUILD` scripts.

### Runtime dependencies

This is controlled by the `<submod>/pkg/setup-deployment.sh` script, which for
`./install deploy-env docker` is run inside a Dockerfile building on Ubuntu
16.04.  The purpose of this script is to install anything that is _not_ local
source or depends on it; e.g. Ubuntu packages, npm packages, and so on.  Nothing
that ever changes in our own repos should affect this script.

The Dockerfile for this is `buildDocker/Dockerfile-deploybase`.

### Deployment

This is an entirely automatic process that simply copies, on top of the runtime
dependencies, the entire contents of `<submod>/pkg/build` (i.e. `$builddir`)
into the root filesystem, either of the local machine or a docker image under
construction.  The startup script for the submodule is `<submod>/pkg/doit.sh`,
which is set as the `ENTRYPOINT` of the docker image if `local-to-docker` is
used.  You can and should use the `$sudo` variable to represent either `sudo`
itself or the empty string, which is automatically selected based on the deploy
mode.

The Dockerfile for this is `buildDocker/Dockerfile`.

## Tagging docker images

If you did a `docker` deployment, the images will be called `strato`, `bloc`,
and so on.  To tag and push them to our registry, run
```
./install tag-and-push <tag name>
```
which will name them `auth.blockapps.net:5000/blockapps/strato:<tag name>` and
so on.  Note that the `docker-compose.yml` file, used in the commands described
below, will still refer to the original names.  If you pull the images onto
another machine to run them, you will either have to tag them back or edit this
file.

## Running

Once the build and deploy steps are completed, you'll have either docker images
or a local install of strato.  

### Running a local install

TBD

### Running the docker images

You will need Docker Compose at least version 1.7.  The basic launch command is
simply
```
docker-compose up -d
```
in the directory with the `docker-compose.yml` file.  This starts strato, the
supporting services (postgres, kafka, zookeeper, nginx) and a bloc server
container.  The blockchain will be in "dev mode", with blocks mined instantly
and the genesis block populated with a "faucet" account that you can get free
ether from.  To change these settings, you need to set environment variables
from those under the `strato` entry of the `docker-compose.yml`.  For instance,
this starts a mining node:
```
genesis=mixed10k instantMining=false lazyBlocks=false miningAlgorithm=SHA
docker-compose up -d
```
The genesis block is pre-set to 10k difficulty, which gives initially quick
block times.  The mining algorithm of SHA is the only one we currently
implement.

It is possible to network several strato nodes.  To do that, each one must be
able to listen on port 30303 tcp/udp on its respective machine.  One of them
will be the "bootnode", and is launched as above.  The others are launched using
the `bootnode` environment variable:
```
bootnode=1.2.3.4 docker-compose up -d
```
This will connect them to the boot node and they will then exchange blocks and
transactions.

To use strato-api, you must be able to connect to nginx on port 443 using HTTPS.
Therefore, the strato machine must have the SSL certs available at
`/etc/ssl/certs/server.pem` and `/etc/ssl/private/server.key`.  Even for the
docker deployment, these files should be on the local filesystem and not inside
a docker container.  The certs ought to match your domain (e.g. blockapps.net).

#### Logs

Logs for the docker containers are available in several ways.  All of them
provide the output of their main process via
```
docker-compose logs -f <service> # i.e. strato, bloc, nginx
```
The strato container violates the Docker philosophy and runs many processes, so
they keep their logs inside the container at `/var/lib/strato/logs` under the
name of each process.  The important ones are `ethereum-vm` (which should show
transactions being executed and blocks being added), `strato-p2p-client` (which
should show blocks being received from peers), and `strato-index` (which should
show blocks being put in the SQL database.  If this stops, the system is
non-functional).

### Resource concerns

Strato makes demands of the processor, the network, and the filesystem.

#### Processor

The three most computationally intensive processes are ethereum-vm, strato-api,
and strato-adit.  The latter, in particular, should be given an entire core to
itself, so that the mining speed is not affected by the load on the rest of the
machine.  strato-api uses enormous processing resources under high load, easily
most of the available power because it is multithreaded and therefore can
operate on many cores simultaneously.  ethereum-vm uses a more modest amount
because it is largely single-threaded, but still potentially more than one core.
At least four cores are therefore advised.

#### Network

The network demands are comparatively light, and network speed has not yet come
to be a significant factor in overall performance.  The network is used both by
strato-api (as a server) and both strato-p2p-client and strato-p2p-server, all
of which do have to receive large amounts of data in the form of transactions
and blocks.

#### Filesystem

The filesystem is controlled by the SQL database for the most part.  Its
performance is a significant factor in overall performance, and therefore needs
to be optimized.  Simply using an SSD for storage contributes greatly and is
virtually required.
