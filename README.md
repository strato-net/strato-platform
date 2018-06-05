![logo](http://blockapps.net/wp-content/uploads/2016/12/blockapps-logo-horizontal-blue-for-web-transparent.png)

# STRATO Platform

## Prerequisites to build

```TODO: build monstrato and bloch with `docker: true` in stack.yaml to remove dependency on environment setup (both ubuntu/mac)```

### Stack
Most unix systems (incl. ubuntu and mac):
```
curl -sSL https://get.haskellstack.org/ | sh
```

### Libraries

#### Ubuntu/debian:

```
sudo apt-get install cmake libboost-all-dev libpq-dev libsodium-dev autoconf libleveldb-dev
```

#### Centos/RHEL/Amazon linux 2

```
sudo yum install http://dl.fedoraproject.org/pub/epel/7/x86_64/Packages/e/epel-release-7-11.noarch.rpm
sudo yum install libsodium libsodium-devel postgresql-devel cmake3 gcc-c++ libleveldb-devel libtool automake libz-devel
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
