/*
 * jlog_config.h - Pre-configured for Linux x86_64
 * 
 * Copyright (c) 2005-2008, Message Systems, Inc.
 * All rights reserved.
 * BSD 3-clause license - see LICENSE
 */

#ifndef __JLOG_CONFIG_H
#define __JLOG_CONFIG_H

#define HAVE_FCNTL_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_LIBGEN_H 1
#define HAVE_DIRENT_H 1
#define HAVE_ERRNO_H 1
#define HAVE_STRING_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STDINT_H 1
#define HAVE_UNISTD_H 1
#define HAVE_SYS_PARAM_H 1
#define HAVE_SYS_MMAN_H 1
#define HAVE_TIME_H 1
#define HAVE_SYS_TIME_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_UIO_H 1
#define HAVE_PWRITEV 1
#define HAVE_INT64_T 1
#define HAVE_INTXX_T 1
#define HAVE_LONG_LONG_INT 1
#define HAVE_UINTXX_T 1
#define HAVE_U_INT 1
#define HAVE_U_INT64_T 1
#define HAVE_U_INTXX_T 1

/* No LZ4 compression - keep it simple */
/* #undef HAVE_LZ4_H */

#define IFS_CH '/'

#ifdef HAVE_STRING_H
#include <string.h>
#endif
#ifdef HAVE_STDLIB_H
#include <stdlib.h>
#endif
#ifdef HAVE_STDINT_H
#include <stdint.h>
#endif
#ifdef HAVE_SYS_PARAM_H
#include <sys/param.h>
#endif
#ifdef HAVE_SYS_TYPES_H
#include <sys/types.h>
#endif
#ifdef HAVE_SYS_STAT_H
#include <sys/stat.h>
#endif
#if HAVE_LIBGEN_H
#include <libgen.h>
#endif

/* Size definitions for Linux x86_64 */
#define SIZEOF_CHAR 1
#define SIZEOF_SHORT_INT 2
#define SIZEOF_INT 4
#define SIZEOF_LONG_INT 8
#define SIZEOF_LONG_LONG_INT 8
#define SIZEOF_SIZE_T 8
#define SIZEOF_VOID_P 8

/* Use standard types from stdint.h */
typedef unsigned int u_int;

#endif
