![logo](http://blockapps.net/wp-content/uploads/2016/12/blockapps-logo-horizontal-blue-for-web-transparent.png)

# STRATO Platform

## Prerequisites to build

### Docker
Install the latest docker from https://www.docker.com/community-edition

### Stack
Most unix systems (incl. ubuntu and mac):
```
curl -sSL https://get.haskellstack.org/ | sh
```

### NodeJS
core-strato requires NodeJS 6+ to fetch blockapps-js (it's deprecated but still used in coinbase generation)

## Build

### Config vars
1. `REPO` env var is required for the build.

    Possible values:
    - `local` (empty docker registry url)
    - `private` (`registry-aws.blockapps.net:5000/blockapps/` - BlockApps' private registry)
    - `public` (`registry-aws.blockapps.net:5000/blockapps-repo/` - BlockApps' public registry)

2. `REPO_URL` (discouraging to use) is optional and may be used to set custom docker registry URL (`REPO` var has more priority and will overridde `REPO_URL`'s value if both are provided)

3. `VERSION` (discouraging to use) is optional and may be used to override the version tag from VERSION file

### Build commands
-  Build all and generate docker-compose.yml:
    ```
    <CONFIG_VARS> make
    ```

- Only build one application (e.g. strato):
    ```
    <CONFIG_VARS> make strato
    ```

- Only generate docker-compose.yml (will overwrite the existing):
    ```
    <CONFIG_VARS> make docker-compose
    ```

## Appendix: Libraries used in build process
For the list of currenty used libraries see Dockerfile.deploybase for run-time libs and Dockerfile.buildbase for compilation lib requirements
These libraries are no longer required to be installed on the host since we use docker-enabled Stack. So we keep them here just in case:


#### Ubuntu/debian:

```
sudo apt-get install cmake libboost-all-dev libpq-dev libsodium-dev autoconf libleveldb-dev
```

#### Centos/RHEL/Amazon linux 2

```
sudo yum install http://dl.fedoraproject.org/pub/epel/7/x86_64/Packages/e/epel-release-7-11.noarch.rpm
sudo yum install libsodium libsodium-devel postgresql-devel cmake3 gcc-c++ libleveldb-devel libtool automake libz-devel libleveldb-devel
```
There are some additional awkward steps to have `cmake3` under a name that solidity can build with
and to install a compatible version of boost:
```
sudo ln -s /usr/bin/cmake3 /usr/local/bin/cmake
wget http://sourceforge.net/projects/boost/files/boost/1.67.0/boost_1_67_0.tar.gz
tar -xvzf boost_1_67_0.tar.gz
cd boost_1_67_0/
./bootstrap.sh
./b2
sudo ./b2 install
```

#### Mac people:

TBD

#### Known issue with 'happy' lib when building on host (non-docker-enabled stack)

Also we need to explicitly install `happy` library on the host:
```
stack install happy-1.19.5
```
possible reason for that is because some of the used libs uses it but doesn't have as a "build-tools" dependency in .cabal
(also see https://github.com/haskell/cabal/issues/4574)
