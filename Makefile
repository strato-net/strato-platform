REPO_URL ?= EMPTY
ifeq ($(REPO),local)
  REPO_URL=
endif
ifeq ($(REPO),private)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps/
endif
ifeq ($(REPO),public)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps-repo/
endif
ifeq ($(REPO_URL),EMPTY)
  $(error REPO not provided or unknown value. Please provide one of the types for REPO var: [local, private, public]. Or custom REPO_URL)
endif
$(info REPO_URL is "${REPO_URL}" (${REPO}))

STACK_RESOLVER=$(shell cat stack.yaml | grep "resolver:" | awk '{print $$2}')
TMPDIR=/tmp/strato-docker-dummy

ifndef VERSION
  ifeq ($(REPO),public)
    VERSION = `cat VERSION`
    $(info Using version tag from VERSION file)
  else
    VERSION = `cat VERSION`-`git rev-parse --short HEAD`
  endif
else
  $(info VERSION is "${VERSION}" (overriden with env var))
endif

$(info )

all: build_all docker-compose

build_all: bloc strato apex docs dappstore nginx postgrest prometheus smd vault-wrapper

.PHONY: bloc strato apex docs dappstore nginx postgrest prometheus smd vault-wrapper

apex:
	@echo Now building apex...
	BASIL_DOCKER_TAG=${REPO_URL}apex:${VERSION} make --directory=apex/

bloc: build_buildbase
	@echo Now building bloc...
	BASIL_DOCKER_TAG=${REPO_URL}bloc:${VERSION} make --directory=blockapps-haskell/

docs:
	@echo Now building docs...
	BASIL_DOCKER_TAG=${REPO_URL}docs:${VERSION} make --directory=blockapps-swagger/

dappstore:
	@echo Now building dappstore...
	BASIL_DOCKER_TAG=${REPO_URL}dappstore:${VERSION} make --directory=dapp-store/

nginx:
	@echo Now building nginx...
	BASIL_DOCKER_TAG=${REPO_URL}nginx:${VERSION} make --directory=nginx-packager/

postgrest:
	@echo Now building postgrest...
	BASIL_DOCKER_TAG=$(REPO_URL)postgrest:${VERSION} make --directory=postgrest-packager/

prometheus:
	@echo Now building prometheus...
	BASIL_DOCKER_TAG=$(REPO_URL)prometheus:${VERSION} make --directory=prometheus-packager/

smd:
	@echo building smd...
	BASIL_DOCKER_TAG=${REPO_URL}smd:${VERSION} make --directory=smd-ui/

strato: build_buildbase
	@echo Now building core-strato...
	BASIL_DOCKER_TAG=${REPO_URL}strato:${VERSION} make --directory=core-strato/

vault-wrapper:
	@echo Now building vault-wrapper...
	BASIL_DOCKER_TAG=${REPO_URL}vault-wrapper:${VERSION} make --directory=blockapps-haskell/vault-wrapper/

docker-compose:
	@echo Now generating docker-compose yml files...
	@echo Creating the image-push-ready docker-compose.push.yml...
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.tpl.yml > docker-compose.push.yml
	@echo Creating the final docker-compose.yml...
	awk '/build: ./{getline} 1' docker-compose.push.yml > docker-compose.yml

build_buildbase:
	mkdir -p $(TMPDIR)
	blockapps-haskell/pull_solc.sh 0.4.25 $(TMPDIR)/solc-0.4 $(TMPDIR)/license
	blockapps-haskell/pull_solc.sh 0.5.1 $(TMPDIR)/solc-0.5 $(TMPDIR)/license
	ln -f $(TMPDIR)/solc-0.4 $(TMPDIR)/solc
	cp -f Dockerfile.buildbase $(TMPDIR)
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=strato-buildbase:${STACK_RESOLVER} -f ${TMPDIR}/Dockerfile.buildbase ${TMPDIR}

test:
	@echo ${VERSION}
