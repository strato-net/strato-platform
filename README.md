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

### Libraries

Libraries requirements are to be removed when STRATO is switched to build stack in docker (STRATO-1004)

#### Ubuntu/debian:

```
sudo apt-get install libpq-dev libsodium-dev autoconf libleveldb-dev libtool
```

#### Centos/RHEL/Amazon linux 2

```
sudo yum install libsodium libsodium-devel postgresql-devel gcc-c++ libleveldb-devel libtool automake
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
