BASILWORK=.basil-work
BASILWORK_ABS=$(shell pwd)/$(BASILWORK)
STACKWORK=$(BASILWORK)/stack
FAKEROOT=$(BASILWORK)/fakeroot
OAUTHHOME=$(FAKEROOT)/usr/bin/oauth
BUILDER_HOME=$(BASILWORK_ABS)/builder_home

STACK_RESOLVER=$(shell cat stack.yaml | grep "resolver:" | awk '{print $$2}')

all: build_docker

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(OAUTHHOME)
	mkdir -p $(BUILDER_HOME)
	mkdir -p /tmp/docker-dummy

build_buildbase: prebuild
	cp -f Dockerfile.buildbase /tmp/docker-dummy
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=stack-oauth-buildbase:${STACK_RESOLVER} -f /tmp/docker-dummy/Dockerfile.buildbase /tmp/docker-dummy

build_haskell: prebuild build_buildbase
	stack setup
	stack install --local-bin-path=$(FAKEROOT)/usr/bin

build_docker: build_haskell
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(OAUTHHOME)
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
	rm -rf /tmp/docker-dummy
