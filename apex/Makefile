ifeq ($(BASIL_DOCKER_TAG),)
  $(error BASIL_DOCKER_TAG is not set)
endif

ifeq ($(ECR_DOCKER_TAG),)
  $(error ECR_DOCKER_TAG is not set)
endif

ifeq ($(STRATO_VERSION),)
  $(error STRATO_VERSION is not set)
endif

all: build

build:
	docker build --build-arg STRATO_VERSION=$(STRATO_VERSION) -t $(BASIL_DOCKER_TAG) api/
	docker tag $(BASIL_DOCKER_TAG) $(ECR_DOCKER_TAG)
