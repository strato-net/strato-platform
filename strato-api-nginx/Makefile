ifeq ($(BASIL_DOCKER_TAG),)
  $(error BASIL_DOCKER_TAG is not set)
endif

ifeq ($(ECR_DOCKER_TAG),)
  $(error ECR_DOCKER_TAG is not set)
endif

all: build

build:
	docker build --add-host=openresty.org:3.125.51.27 -t $(BASIL_DOCKER_TAG) .
	docker tag $(BASIL_DOCKER_TAG) $(ECR_DOCKER_TAG)
