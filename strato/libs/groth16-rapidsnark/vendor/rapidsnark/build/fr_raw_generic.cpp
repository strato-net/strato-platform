#include "fr_element.hpp"
#include <gmp.h>
#include <cstring>

// Compatibility for macOS ARM64 where uint64_t is unsigned long long
// but GMP's mp_limb_t is unsigned long (both 64-bit but different types)
#if defined(__APPLE__) && defined(__aarch64__)
#define GMP_CAST(x) reinterpret_cast<mp_ptr>(x)
#define GMP_CONST_CAST(x) reinterpret_cast<mp_srcptr>(x)
#else
#define GMP_CAST(x) (x)
#define GMP_CONST_CAST(x) (x)
#endif

static uint64_t     Fr_rawq[] = {0x43e1f593f0000001,0x2833e84879b97091,0xb85045b68181585d,0x30644e72e131a029, 0};
static uint64_t     Fr_np     = {0xc2e1f593efffffff};
static uint64_t     lboMask   =  0x3fffffffffffffff;


void Fr_rawAdd(FrRawElement pRawResult, const FrRawElement pRawA, const FrRawElement pRawB)
{
    uint64_t carry = mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fr_N64);

    if(carry || mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawAddLS(FrRawElement pRawResult, FrRawElement pRawA, uint64_t rawB)
{
    uint64_t carry = mpn_add_1(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), Fr_N64, rawB);

    if(carry || mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawSub(FrRawElement pRawResult, const FrRawElement pRawA, const FrRawElement pRawB)
{
    uint64_t carry = mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fr_N64);

    if(carry)
    {
        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawSubRegular(FrRawElement pRawResult, FrRawElement pRawA, FrRawElement pRawB)
{
    mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fr_N64);
}

void Fr_rawSubSL(FrRawElement pRawResult, uint64_t rawA, FrRawElement pRawB)
{
    FrRawElement pRawA = {rawA, 0, 0, 0};

    uint64_t carry = mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fr_N64);

    if(carry)
    {
        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawSubLS(FrRawElement pRawResult, FrRawElement pRawA, uint64_t rawB)
{
    uint64_t carry = mpn_sub_1(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), Fr_N64, rawB);

    if(carry)
    {
        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawNeg(FrRawElement pRawResult, const FrRawElement pRawA)
{
    const uint64_t zero[Fr_N64] = {0, 0, 0, 0};

    if (mpn_cmp(GMP_CONST_CAST(pRawA), GMP_CONST_CAST(zero), Fr_N64) != 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), GMP_CONST_CAST(pRawA), Fr_N64);
    }
    else
    {
        mpn_copyi(GMP_CAST(pRawResult), GMP_CONST_CAST(zero), Fr_N64);
    }
}

//  Substracts a long element and a short element form 0
void Fr_rawNegLS(FrRawElement pRawResult, FrRawElement pRawA, uint64_t rawB)
{
    uint64_t carry1 = mpn_sub_1(GMP_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64, rawB);
    uint64_t carry2 = mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(pRawA), Fr_N64);

    if (carry1 || carry2)
    {
        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawCopy(FrRawElement pRawResult, const FrRawElement pRawA)
{
    pRawResult[0] = pRawA[0];
    pRawResult[1] = pRawA[1];
    pRawResult[2] = pRawA[2];
    pRawResult[3] = pRawA[3];
}

int Fr_rawIsEq(const FrRawElement pRawA, const FrRawElement pRawB)
{
    return mpn_cmp(GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fr_N64) == 0;
}

void Fr_rawMMul(FrRawElement pRawResult, const FrRawElement pRawA, const FrRawElement pRawB)
{
    const mp_size_t  N = Fr_N64+1;
    const uint64_t  *mq = Fr_rawq;

    uint64_t  np0;

    uint64_t  product0[N] = {0};
    uint64_t  product1[N] = {0};
    uint64_t  product2[N] = {0};
    uint64_t  product3[N] = {0};

    product0[4] = mpn_mul_1(GMP_CAST(product0), GMP_CONST_CAST(pRawB), Fr_N64, pRawA[0]);

    np0 = Fr_np * product0[0];
    product1[1] = mpn_addmul_1(GMP_CAST(product0), GMP_CONST_CAST(mq), N, np0);

    product1[4] = mpn_addmul_1(GMP_CAST(product1), GMP_CONST_CAST(pRawB), Fr_N64, pRawA[1]);
    mpn_add(GMP_CAST(product1), GMP_CONST_CAST(product1), N, GMP_CONST_CAST(product0+1), N-1);

    np0 = Fr_np * product1[0];
    product2[1] = mpn_addmul_1(GMP_CAST(product1), GMP_CONST_CAST(mq), N, np0);

    product2[4] = mpn_addmul_1(GMP_CAST(product2), GMP_CONST_CAST(pRawB), Fr_N64, pRawA[2]);
    mpn_add(GMP_CAST(product2), GMP_CONST_CAST(product2), N, GMP_CONST_CAST(product1+1), N-1);

    np0 = Fr_np * product2[0];
    product3[1] = mpn_addmul_1(GMP_CAST(product2), GMP_CONST_CAST(mq), N, np0);

    product3[4] = mpn_addmul_1(GMP_CAST(product3), GMP_CONST_CAST(pRawB), Fr_N64, pRawA[3]);
    mpn_add(GMP_CAST(product3), GMP_CONST_CAST(product3), N, GMP_CONST_CAST(product2+1), N-1);

    np0 = Fr_np * product3[0];
    mpn_addmul_1(GMP_CAST(product3), GMP_CONST_CAST(mq), N, np0);

    mpn_copyi(GMP_CAST(pRawResult), GMP_CONST_CAST(product3+1), Fr_N64);

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fr_N64);
    }
}

void Fr_rawMMul1(FrRawElement pRawResult, const FrRawElement pRawA, uint64_t pRawB)
{
    const mp_size_t  N = Fr_N64+1;
    const uint64_t  *mq = Fr_rawq;

    uint64_t  np0;

    uint64_t  product0[N] = {0};
    uint64_t  product1[N] = {0};
    uint64_t  product2[N] = {0};
    uint64_t  product3[N] = {0};

    product0[4] = mpn_mul_1(GMP_CAST(product0), GMP_CONST_CAST(pRawA), Fr_N64, pRawB);

    np0 = Fr_np * product0[0];
    product1[1] = mpn_addmul_1(GMP_CAST(product0), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product1), GMP_CONST_CAST(product1), N, GMP_CONST_CAST(product0+1), N-1);

    np0 = Fr_np * product1[0];
    product2[1] = mpn_addmul_1(GMP_CAST(product1), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product2), GMP_CONST_CAST(product2), N, GMP_CONST_CAST(product1+1), N-1);

    np0 = Fr_np * product2[0];
    product3[1] = mpn_addmul_1(GMP_CAST(product2), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product3), GMP_CONST_CAST(product3), N, GMP_CONST_CAST(product2+1), N-1);

    np0 = Fr_np * product3[0];
    mpn_addmul_1(GMP_CAST(product3), GMP_CONST_CAST(mq), N, np0);

    mpn_copyi(GMP_CAST(pRawResult), GMP_CONST_CAST(product3+1), Fr_N64);

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fr_N64);
    }
}

void Fr_rawFromMontgomery(FrRawElement pRawResult, const FrRawElement &pRawA)
{
    const mp_size_t  N = Fr_N64+1;
    const uint64_t  *mq = Fr_rawq;

    uint64_t  np0;

    uint64_t  product0[N];
    uint64_t  product1[N] = {0};
    uint64_t  product2[N] = {0};
    uint64_t  product3[N] = {0};

    mpn_copyi(GMP_CAST(product0), GMP_CONST_CAST(pRawA), Fr_N64); product0[4] = 0;

    np0 = Fr_np * product0[0];
    product1[1] = mpn_addmul_1(GMP_CAST(product0), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product1), GMP_CONST_CAST(product1), N, GMP_CONST_CAST(product0+1), N-1);

    np0 = Fr_np * product1[0];
    product2[1] = mpn_addmul_1(GMP_CAST(product1), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product2), GMP_CONST_CAST(product2), N, GMP_CONST_CAST(product1+1), N-1);

    np0 = Fr_np * product2[0];
    product3[1] = mpn_addmul_1(GMP_CAST(product2), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product3), GMP_CONST_CAST(product3), N, GMP_CONST_CAST(product2+1), N-1);

    np0 = Fr_np * product3[0];
    mpn_addmul_1(GMP_CAST(product3), GMP_CONST_CAST(mq), N, np0);

    mpn_copyi(GMP_CAST(pRawResult), GMP_CONST_CAST(product3+1), Fr_N64);

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fr_N64);
    }
}

int Fr_rawIsZero(const FrRawElement rawA)
{
    return mpn_zero_p(GMP_CONST_CAST(rawA), Fr_N64) ? 1 : 0;
}

int Fr_rawCmp(FrRawElement pRawA, FrRawElement pRawB)
{
    return mpn_cmp(GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fr_N64);
}

void Fr_rawSwap(FrRawElement pRawResult, FrRawElement pRawA)
{
    FrRawElement temp;

    temp[0] = pRawResult[0];
    temp[1] = pRawResult[1];
    temp[2] = pRawResult[2];
    temp[3] = pRawResult[3];

    pRawResult[0] = pRawA[0];
    pRawResult[1] = pRawA[1];
    pRawResult[2] = pRawA[2];
    pRawResult[3] = pRawA[3];

    pRawA[0] = temp[0];
    pRawA[1] = temp[1];
    pRawA[2] = temp[2];
    pRawA[3] = temp[3];
}

void Fr_rawCopyS2L(FrRawElement pRawResult, int64_t val)
{
    pRawResult[0] = val;
    pRawResult[1] = 0;
    pRawResult[2] = 0;
    pRawResult[3] = 0;

    if (val < 0)
    {
        pRawResult[1] = -1;
        pRawResult[2] = -1;
        pRawResult[3] = -1;

        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawAnd(FrRawElement pRawResult, FrRawElement pRawA, FrRawElement pRawB)
{
    mpn_and_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fr_N64);

    pRawResult[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawOr(FrRawElement pRawResult, FrRawElement pRawA, FrRawElement pRawB)
{
    mpn_ior_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fr_N64);

    pRawResult[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawXor(FrRawElement pRawResult, FrRawElement pRawA, FrRawElement pRawB)
{
    mpn_xor_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fr_N64);

    pRawResult[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawShl(FrRawElement r, FrRawElement a, uint64_t b)
{
    uint64_t bit_shift  = b % 64;
    uint64_t word_shift = b / 64;
    uint64_t word_count = Fr_N64 - word_shift;

    mpn_copyi(GMP_CAST(r + word_shift), GMP_CONST_CAST(a), word_count);
    std::memset(r, 0, word_shift * sizeof(uint64_t));

    if (bit_shift)
    {
        mpn_lshift(GMP_CAST(r), GMP_CONST_CAST(r), Fr_N64, bit_shift);
    }

    r[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(r), GMP_CONST_CAST(Fr_rawq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(r), GMP_CONST_CAST(r), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}

void Fr_rawShr(FrRawElement r, FrRawElement a, uint64_t b)
{
    const uint64_t bit_shift  = b % 64;
    const uint64_t word_shift = b / 64;
    const uint64_t word_count = Fr_N64 - word_shift;

    mpn_copyi(GMP_CAST(r), GMP_CONST_CAST(a + word_shift), word_count);
    std::memset(r + word_count, 0, word_shift * sizeof(uint64_t));

    if (bit_shift)
    {
        mpn_rshift(GMP_CAST(r), GMP_CONST_CAST(r), Fr_N64, bit_shift);
    }
}

void Fr_rawNot(FrRawElement pRawResult, FrRawElement pRawA)
{
    mpn_com(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), Fr_N64);

    pRawResult[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fr_rawq), Fr_N64);
    }
}
