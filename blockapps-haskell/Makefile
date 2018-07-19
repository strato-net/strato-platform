BASILWORK=.basil-work
BASILWORK_ABS=$(shell pwd)/$(BASILWORK)
STACKWORK=$(BASILWORK)/stack
FAKEROOT=$(BASILWORK)/fakeroot
BLOCHOME=$(FAKEROOT)/usr/bin/bloc
BUILDER_HOME=$(BASILWORK_ABS)/builder_home
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

STACK_RESOLVER=$(shell cat stack.yaml | grep "resolver:" | awk '{print $$2}')

SOLC_VERSION=0.4.24

all: build_docker

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(BLOCHOME)
	mkdir -p $(BUILDER_HOME)
	mkdir -p /tmp/docker-dummy

build_solidity: prebuild
	./pull_solc.sh $(SOLC_VERSION) $(FAKEROOT)/usr/bin

build_buildbase: prebuild build_solidity
	cp -f Dockerfile.buildbase /tmp/docker-dummy
	cp -f $(FAKEROOT)/usr/bin/solc /tmp/docker-dummy
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=stack-bloc-buildbase:${STACK_RESOLVER} -f /tmp/docker-dummy/Dockerfile.buildbase /tmp/docker-dummy

build_haskell: prebuild build_buildbase
	stack setup
	stack install --local-bin-path=$(FAKEROOT)/usr/bin

build_deploybase: prebuild
	cp -f Dockerfile.deploybase /tmp/docker-dummy
	docker build --tag=$(DEPLOYBASE_NAME):latest -f /tmp/docker-dummy/Dockerfile.deploybase /tmp/docker-dummy
	rm -f /tmp/docker-dummy/Dockerfile.deploybase

build_docker: build_deploybase build_solidity build_haskell
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-strato-server $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-bloc $(BLOCHOME)
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
	rm -rf /tmp/docker-dummy
