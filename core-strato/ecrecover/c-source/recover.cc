
typedef __int128 int128_t;
typedef unsigned __int128 uint128_t;

#define USE_NUM_GMP
#define USE_SCALAR_4X64
#define USE_SCALAR_INV_NUM

#define USE_FIELD_10X26
#define USE_FIELD_INV_NUM

#include "secp256k1/include/secp256k1.h"
#include "secp256k1/util.h"
#include "secp256k1/ecmult_gen.h"

#include "secp256k1/secp256k1.c"


secp256k1_context_t *context = NULL;


extern "C" int recover_uncompressed(unsigned char *sigR, unsigned char *sigS, int recid, unsigned char *message_hash_bytes, unsigned char *pubkey_bytes) {
  if (context == NULL) context = secp256k1_context_create(SECP256K1_CONTEXT_VERIFY);
    
  secp256k1_ecdsa_sig_t sig;
  secp256k1_ge_t pubkey;
  secp256k1_scalar_t message;

  secp256k1_scalar_set_b32(&message, message_hash_bytes, NULL);

  secp256k1_scalar_set_b32(&sig.r, sigR, 0);
  secp256k1_scalar_set_b32(&sig.s, sigS, 0);
  
  int response = secp256k1_ecdsa_sig_recover(&context->ecmult_ctx, &sig, &pubkey, &message, recid);
    
  if (response != 1) {
    return 1;
  }
  
  unsigned char buff[65];
  int size;
  
  secp256k1_eckey_pubkey_serialize(&pubkey, buff, &size, 0);
  if (size != 65) {
    return 2;
  }

  memcpy(pubkey_bytes, buff, 65);
  
  return 0;
}

extern "C" int recover_compressed(unsigned char *sigR, unsigned char *sigS, int recid, unsigned char *message_hash_bytes, unsigned char *pubkey_bytes) {
  if (context == NULL) context = secp256k1_context_create(SECP256K1_CONTEXT_VERIFY);
    
  secp256k1_ecdsa_sig_t sig;
  secp256k1_ge_t pubkey;
  secp256k1_scalar_t message;

  secp256k1_scalar_set_b32(&message, message_hash_bytes, NULL);

  secp256k1_scalar_set_b32(&sig.r, sigR, 0);
  secp256k1_scalar_set_b32(&sig.s, sigS, 0);
  
  int response = secp256k1_ecdsa_sig_recover(&context->ecmult_ctx, &sig, &pubkey, &message, recid);
    
  if (response != 1) {
    return 1;
  }
  
  unsigned char buff[33];
  int size;
  
  secp256k1_eckey_pubkey_serialize(&pubkey, buff, &size, 0);
  if (size != 65) {
    return 2;
  }

  memcpy(pubkey_bytes, buff, 33);

  // Mark as compressed:
  pubkey_bytes[0] = 3;
  
  return 0;
}
