#include <time.h>
#include <stdio.h>

struct timespec beforeTS;

long clockgettime () {
  struct timespec time1;
  clock_gettime(CLOCK_MONOTONIC, &time1);
  printf("%ld\n", time1.tv_nsec);
  return time1.tv_nsec;
}

void before () {
  clock_gettime(CLOCK_MONOTONIC, &beforeTS);
}

long after () {
  struct timespec afterTS;
  clock_gettime(CLOCK_MONOTONIC, &afterTS);
  //  printf("doggy %ld\n", afterTS.tv_nsec - beforeTS.tv_nsec);
  return (1000000000L * (afterTS.tv_sec - beforeTS.tv_sec) + afterTS.tv_nsec - beforeTS.tv_nsec);
}
