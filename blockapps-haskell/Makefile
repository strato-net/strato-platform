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
SLIPSTREAM=${FAKEROOT}/usr/bin/slipstream

SOLCBRANCH=0.4.8-no-md
SOLCREPOSITORY=https://github.com/blockapps/solidity.git
SOLCBUILDDIR=$(SOLCWORK)/solidity/build
SOLCMAKEFLAGS=-j4
ifeq ($(USE_DOCKER_BUILD_ENV),)
SOLCCMAKE=cd $(SOLCBUILDDIR) && cd .. && git submodule update && cd build && cmake -DCMAKE_INSTALL_PREFIX=$(shell pwd)/$(FAKEROOT)/usr .. && make $(SOLCMAKEFLAGS) solc
else
SOLCCMAKE=$(DOCKER_SHELL) "cd $(SOLCBUILDDIR) && cd .. && git submodule update && cd build && cmake -DCMAKE_INSTALL_PREFIX=$(DOCKER_FAKEROOT)/usr .."
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
ifneq ("$(wildcard $(SOLCBUILDDIR)/Makefile)","")
	echo "$(SOLCBUILDDIR)/Makefile already exists, so solc was probably already cmake'd. Not cmake-ing."
else
ifneq ("$(wildcard $(SOLCWORK)/solidity/.git)","")
	echo "solidity already cloned, will skip"
else
	git -C $(SOLCWORK) clone --recursive --branch $(SOLCBRANCH) $(SOLCREPOSITORY)
endif
	mkdir -p $(SOLCBUILDDIR)
	$(SOLCCMAKE)
endif
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
