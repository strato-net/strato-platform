REPO_URL ?= 
ifeq ($(REPO),private)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps/
endif
ifeq ($(REPO),public)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps-repo/
endif
$(info REPO_URL is "${REPO_URL}" (REPO: "${REPO}"))
REPO_AWS_ECR_URL=406773134706.dkr.ecr.us-east-1.amazonaws.com/strato/
# TODO: merge two REPO vars
REPO_AWS_ECR_URL_MERCATA=406773134706.dkr.ecr.us-east-1.amazonaws.com/mercata/
$(info REPO_AWS_ECR_URL is "${REPO_AWS_ECR_URL}")

STACK_RESOLVER=$(shell cat strato/stack.yaml | grep "resolver:" | awk '{print $$2}')
FAKEROOT=$(shell pwd)/.docker-work
HIGHWAYDIR=${FAKEROOT}/highway
STRATODIR=${FAKEROOT}/strato
VAULTDIR=${FAKEROOT}/vault-wrapper
IDENTITYDIR=${FAKEROOT}/identity-provider

ifndef VERSION
  ifeq ($(REPO),public)
    VERSION = `cat VERSION`
    $(info Using version tag from VERSION file)
  else
    VERSION = `cat VERSION`-`git rev-parse --short=7 HEAD`
  endif
else
  $(info VERSION is "${VERSION}" (overriden with env var))
endif

$(info )

all: mercata

docker: build_all_docker docker-compose eks

all_develop: build_develop docker-compose eks

mercata: build_common apex nginx postgrest prometheus smd mercata-backend mercata-ui mercata-bridge mercata-oracle mercata-stripe docker-compose

build_all_docker: build_common_docker strato_docker apex highway highway-nginx nginx postgrest prometheus smd vault-wrapper vault-nginx mercata-backend mercata-ui mercata-bridge mercata-oracle mercata-stripe

build_develop: develop apex highway highway-nginx nginx postgrest prometheus smd vault-wrapper vault-nginx mercata-backend mercata-ui mercata-bridge mercata-oracle mercata-stripe

.PHONY: all_develop apex build_all_docker build_buildbase build_common build_common_docker build_common_profiled build_develop docker-compose eks highway highway-nginx mercata mercata-backend mercata-bridge mercata-oracle mercata-stripe mercata-ui nginx postgrest prometheus smd strato strato_docker vault-nginx vault-wrapper

apex:
	@echo Now building apex...
	BASIL_DOCKER_TAG=${REPO_URL}apex:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}apex:${VERSION} STRATO_VERSION=${VERSION} make --directory=apex/

nginx:
	@echo Now building nginx...
	BASIL_DOCKER_TAG=${REPO_URL}nginx:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}nginx:${VERSION} make --directory=nginx-packager/

postgrest:
	@echo Now building postgrest...
	BASIL_DOCKER_TAG=$(REPO_URL)postgrest:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}postgrest:${VERSION} make --directory=postgrest-packager/

prometheus:
	@echo Now building prometheus...
	BASIL_DOCKER_TAG=$(REPO_URL)prometheus:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}prometheus:${VERSION} make --directory=prometheus-packager/

smd:
	@echo building smd...
	BASIL_DOCKER_TAG=${REPO_URL}smd:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}smd:${VERSION} STRATO_VERSION=${VERSION} make --directory=smd-ui/

mercata-backend:
	@echo Now building mercata-backend...
	docker build -t ${REPO_URL}mercata-backend:${VERSION} ./mercata/backend
	docker tag ${REPO_URL}mercata-backend:${VERSION} ${REPO_AWS_ECR_URL}mercata-backend:${VERSION}
    	
mercata-ui:
	@echo Now building mercata-ui...
	docker build -t ${REPO_URL}mercata-ui:${VERSION} ./mercata/ui
	docker tag ${REPO_URL}mercata-ui:${VERSION} ${REPO_AWS_ECR_URL}mercata-ui:${VERSION}

mercata-bridge:
	@echo Now building mercata-bridge...
	docker build -t ${REPO_URL}mercata-bridge:${VERSION} ./mercata/services/bridge
	docker tag ${REPO_URL}mercata-bridge:${VERSION} ${REPO_AWS_ECR_URL_MERCATA}bridge:${VERSION}
	# TODO: #dcpush - replace with proper docker compose push flow
	echo "${REPO_URL}mercata-bridge:${VERSION}" > bridge_image_tag
	echo "${REPO_AWS_ECR_URL_MERCATA}bridge:${VERSION}" > bridge_image_tag_ecr

mercata-oracle:
	@echo Now building mercata-oracle... 
	# TODO: Dockerize
	@echo TODO: NO DOCKERFILE TO BUILD YET...
	#docker build -t ${REPO_URL}mercata-oracle:${VERSION} ./mercata/services/oracle
	#docker tag ${REPO_URL}mercata-oracle:${VERSION} ${REPO_AWS_ECR_URL_MERCATA}oracle:${VERSION}
	# TODO: #dcpush - replace with proper docker compose push flow
	#echo "${REPO_URL}mercata-oracle:${VERSION}" > oracle_image_tag
	#echo "${REPO_AWS_ECR_URL_MERCATA}oracle:${VERSION}" > oracle_image_tag_ecr

mercata-stripe:
	@echo Now building mercata-stripe...
	docker build -t ${REPO_URL}mercata-stripe:${VERSION} ./mercata/services/payment/stripe
	docker tag ${REPO_URL}mercata-stripe:${VERSION} ${REPO_AWS_ECR_URL_MERCATA}stripe:${VERSION}
	# TODO: #dcpush - replace with proper docker compose push flow
	echo "${REPO_URL}mercata-stripe:${VERSION}" > stripe_image_tag
	echo "${REPO_AWS_ECR_URL_MERCATA}stripe:${VERSION}" > stripe_image_tag_ecr

eks:
	@echo Now generating eks manifest files
	cd k8s/eks/strato && sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' strato-platform-manifest.tpl.yaml > strato-platform-manifest.yaml
	cd k8s/eks/vault && sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' eks-vault-deployment.tpl.yaml > eks-vault-deployment.yaml
	#TODO: create eks manifests for highway server, etc...

build_formatter:
	@echo building code formatter...
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=strato-formatter:${STACK_RESOLVER} - < Dockerfile.formatter

build_common:
	@echo building haskell libraries and creating directories
	mkdir -p ${HIGHWAYDIR}
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	mkdir -p ${IDENTITYDIR}
	cd strato && stack install \
		--test --no-run-tests

build_common_docker:
	@echo building haskell libraries and creating directories in docker
	mkdir -p ${HIGHWAYDIR}
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	mkdir -p ${IDENTITYDIR}
	cd strato && stack build \
		--test --no-run-tests \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

build_common_profiled:
	@echo building haskell libraries and creating directories (profiled)
	mkdir -p ${HIGHWAYDIR}
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	mkdir -p ${IDENTITYDIR}
	cd strato && stack build \
		--profile --work-dir .stack-work-profile \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

build_common_fast:
	@echo building haskell libraries and creating directories (fast)
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	mkdir -p ${IDENTITYDIR}
	cd strato && stack build \
		--fast --no-run-tests \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

pretty: build_formatter
	@echo formatting STRATO Haskell code...
	docker run --rm -v .:/strato-platform strato-formatter:${STACK_RESOLVER} ormolu --mode inplace `git ls-files '*.hs'`

gen-hie: build_formatter develop
	@echo generating hie.yaml file...
	docker run --rm -v .:/strato-platform strato-formatter:${STACK_RESOLVER} `cd strato && gen-hie > hie.yaml`

hoogle_generate:
	@echo generating STRATO documentation...
	cd strato && \
		stack haddock --haddock-internal && \
		stack hoogle generate -- --local
	
hoogle_serve:
	@echo serving the pregenerated STRATO documentation...
	cd strato && \
		stack hoogle -- server --local

hoogle: hoogle_generate hoogle_serve

highway: build_common_docker
	@echo Now building highway...
	cp strato/highway/doit.sh ${HIGHWAYDIR}
	docker build --target highway --tag ${REPO_URL}highway:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}highway:${VERSION} ${REPO_AWS_ECR_URL}highway:${VERSION}

highway-nginx:
	@echo Now building highway-nginx...
	BASIL_DOCKER_TAG=${REPO_URL}highway-nginx:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}highway-nginx:${VERSION} make --directory=highway-nginx/

strato: build_common
	@echo Now building core-strato...
	cp -fr strato/extraFiles/* ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}strato:${VERSION} ${REPO_AWS_ECR_URL}strato:${VERSION}

strato_docker: build_common_docker
	@echo Now building core-strato for docker...
	cp -fr strato/extraFiles/* ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}strato:${VERSION} ${REPO_AWS_ECR_URL}strato:${VERSION}

develop: build_common_fast
	@echo Now building core-strato using --fast...
	cp -fr strato/extraFiles/* ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}strato:${VERSION} ${REPO_AWS_ECR_URL}strato:${VERSION}

profile: build_common_profiled
	@echo Now building core-strato using --profile...
	cp -fr strato/extraFiles/* ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}strato:${VERSION} ${REPO_AWS_ECR_URL}strato:${VERSION}

vault-wrapper: build_common_docker
	@echo Now building vault-wrapper...
	cp strato/vault/doit.sh ${VAULTDIR}
	docker build --target vault-wrapper --tag ${REPO_URL}vault-wrapper:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}vault-wrapper:${VERSION} ${REPO_AWS_ECR_URL}vault-wrapper:${VERSION}

vault-nginx:
	@echo Now building vault-nginx...
	BASIL_DOCKER_TAG=${REPO_URL}vault-nginx:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}vault-nginx:${VERSION} make --directory=vault-nginx/

docker-compose:
	@echo Now generating docker-compose yml files...
	@echo Creating the image-push-ready docker-compose.push.yml...
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.tpl.yml > docker-compose.push.yml
	sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.tpl.yml > docker-compose.push.ecr.yml
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.allDocker.tpl.yml > docker-compose.allDocker.push.yml
	sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.allDocker.tpl.yml > docker-compose.allDocker.push.ecr.yml
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.vault.tpl.yml > docker-compose.vault.push.yml
	sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.vault.tpl.yml > docker-compose.vault.push.ecr.yml
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.highway.tpl.yml > docker-compose.highway.push.yml
	sed -e 's|<REPO_URL>|'"${REPO_AWS_ECR_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.highway.tpl.yml > docker-compose.highway.push.ecr.yml

	@echo Creating the final docker-compose.yml...
	awk '/build: ./{getline} 1' docker-compose.push.yml > docker-compose.yml
	awk '/build: ./{getline} 1' docker-compose.allDocker.push.yml > docker-compose.allDocker.yml
	awk '/build: ./{getline} 1' docker-compose.push.ecr.yml > docker-compose.ecr.yml
	awk '/build: ./{getline} 1' docker-compose.allDocker.push.ecr.yml > docker-compose.allDocker.ecr.yml
	awk '/build: ./{getline} 1' docker-compose.vault.push.yml > docker-compose.vault.yml
	awk '/build: ./{getline} 1' docker-compose.vault.push.ecr.yml > docker-compose.vault.ecr.yml
	awk '/build: ./{getline} 1' docker-compose.highway.push.yml > docker-compose.highway.yml
	awk '/build: ./{getline} 1' docker-compose.highway.push.ecr.yml > docker-compose.highway.ecr.yml

docker-build:
	cp -fr strato/extraFiles/* ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}

test:
	@echo ${VERSION}

docker-clean:
	rm -rf ${FAKEROOT}
