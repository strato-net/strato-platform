ifeq ($(BASIL_DOCKER_TAG),)
 $(error BASIL_DOCKER_TAG is not set)
endif

BASILWORK=.basil-work
BASILWORK_ABS=$(shell pwd)/$(BASILWORK)
STACKWORK=$(BASILWORK)/stack
SOLCWORK=$(BASILWORK)/solc
FAKEROOT=$(BASILWORK)/fakeroot
BLOCHOME=$(FAKEROOT)/usr/bin/bloc
BUILDER_HOME=$(BASILWORK_ABS)/builder_home
DOCKER_FAKEROOT=/workspace/.basil-work/fakeroot
BUILDBASE_NAME=bloch-buildbase
DEPLOYBASE_NAME=bloch-deploybase
DOCKER_SHELL=docker run -i --rm --ulimit nofile=65535 -v $(shell pwd):/workspace -v $(BUILDER_HOME):/root $(BUILDBASE_NAME):latest bash -c


SOLCBRANCH=v0.4.24
SOLCREPOSITORY=https://github.com/ethereum/solidity.git
SOLCBUILDDIR=$(SOLCWORK)/solidity/build
SOLCMAKEFLAGS=-j4
SOLCCMAKEFLAGS=-DSOLC_LINK_STATIC=1 -DTESTS=0 -DCMAKE_BUILD_TYPE=Release
ifeq ($(USE_DOCKER_BUILD_ENV),)
SOLCCMAKE=cd $(SOLCBUILDDIR) && cd .. && git submodule update && cd build && cmake -DCMAKE_INSTALL_PREFIX=$(shell pwd)/$(FAKEROOT)/usr .. $(SOLCCMAKEFLAGS) && make $(SOLCMAKEFLAGS) solc
else
SOLCCMAKE=$(DOCKER_SHELL) "cd $(SOLCBUILDDIR) && cd .. && git submodule update && cd build && cmake -DCMAKE_INSTALL_PREFIX=$(DOCKER_FAKEROOT)/usr $(SOLCCMAKEFLAGS) .."
endif
SOLCMAKEINSTALL=make $(SOLCMAKEFLAGS) -C $(SOLCBUILDDIR) install

EXTRADEPS=doit.sh

ifeq ($(USE_DOCKER_BUILD_ENV),)
STACKFLAGS=
else
STACKFLAGS=--allow-different-user
endif

BUILD_HASKELL=stack setup $(STACKFLAGS) && stack install $(STACKFLAGS) --local-bin-path=$(FAKEROOT)/usr/bin

all: build_docker

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(SOLCWORK)
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(BLOCHOME)
	mkdir -p $(BUILDER_HOME)
	mkdir -p /tmp/docker-dummy

build_solidity: prebuild build_buildbase
	# Check both branch name and tag name for a match
ifeq (, $(findstring $(SOLCBRANCH), $(shell git -C $(SOLCWORK)/solidity reflog --decorate -1)))
	$(info "Solc branch is not up to date, cloning $(SOLCREPOSITORY), checking out $(SOLCBRANCH) and rebuilding")
	rm -rf $(SOLCWORK)/solidity
	git -C $(SOLCWORK) clone --recursive --branch $(SOLCBRANCH) $(SOLCREPOSITORY)
	mkdir -p $(SOLCBUILDDIR)
	$(SOLCCMAKE)
else
	echo "Solc branch is up to date, therefore will not recreate solc's Makefile."
endif
	echo "Installing solidity"
ifeq ($(USE_DOCKER_BUILD_ENV),)
	$(SOLCMAKEINSTALL)
else
	$(DOCKER_SHELL) "$(SOLCMAKEINSTALL)"
endif

build_haskell: build_buildbase prebuild
ifeq ($(USE_DOCKER_BUILD_ENV),)
	$(BUILD_HASKELL)
else
	$(DOCKER_SHELL) "$(BUILD_HASKELL)"
endif

build_deploybase: prebuild
	cp -f Dockerfile.deploybase /tmp/docker-dummy
	docker build -t $(DEPLOYBASE_NAME):latest -f /tmp/docker-dummy/Dockerfile.deploybase /tmp/docker-dummy
	rm -f /tmp/docker-dummy/Dockerfile.deploybase

build_buildbase: build_deploybase prebuild
ifeq ($(USE_DOCKER_BUILD_ENV),)
	echo "USE_DOCKER_BUILD_ENV not set, not building buildbase" ;
else
	cp -f Dockerfile.buildbase stack.yaml /tmp/docker-dummy
	docker build -t $(BUILDBASE_NAME):latest -f /tmp/docker-dummy/Dockerfile.buildbase /tmp/docker-dummy
	rm -f /tmp/docker-dummy/Dockerfile.buildbase /tmp/docker-dummy/stack.yaml
endif

build_docker: build_deploybase build_solidity build_haskell
	cp -f Dockerfile $(FAKEROOT)
	cp -f $(EXTRADEPS) $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-strato-server $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-bloc $(BLOCHOME)
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
