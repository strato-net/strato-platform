#include "fq_element.hpp"
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

static uint64_t     Fq_rawq[] = {0x3c208c16d87cfd47,0x97816a916871ca8d,0xb85045b68181585d,0x30644e72e131a029, 0};
static uint64_t     Fq_np     = {0x87d20782e4866389};
static uint64_t     lboMask   =  0x3fffffffffffffff;


void Fq_rawAdd(FqRawElement pRawResult, const FqRawElement pRawA, const FqRawElement pRawB)
{
    uint64_t carry = mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fq_N64);

    if(carry || mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawAddLS(FqRawElement pRawResult, FqRawElement pRawA, uint64_t rawB)
{
    uint64_t carry = mpn_add_1(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), Fq_N64, rawB);

    if(carry || mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawSub(FqRawElement pRawResult, const FqRawElement pRawA, const FqRawElement pRawB)
{
    uint64_t carry = mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fq_N64);

    if(carry)
    {
        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawSubRegular(FqRawElement pRawResult, FqRawElement pRawA, FqRawElement pRawB)
{
    mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fq_N64);
}

void Fq_rawSubSL(FqRawElement pRawResult, uint64_t rawA, FqRawElement pRawB)
{
    FqRawElement pRawA = {rawA, 0, 0, 0};

    uint64_t carry = mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fq_N64);

    if(carry)
    {
        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawSubLS(FqRawElement pRawResult, FqRawElement pRawA, uint64_t rawB)
{
    uint64_t carry = mpn_sub_1(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), Fq_N64, rawB);

    if(carry)
    {
        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawNeg(FqRawElement pRawResult, const FqRawElement pRawA)
{
    const uint64_t zero[Fq_N64] = {0, 0, 0, 0};

    if (mpn_cmp(GMP_CONST_CAST(pRawA), GMP_CONST_CAST(zero), Fq_N64) != 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), GMP_CONST_CAST(pRawA), Fq_N64);
    }
    else
    {
        mpn_copyi(GMP_CAST(pRawResult), GMP_CONST_CAST(zero), Fq_N64);
    }
}

//  Substracts a long element and a short element form 0
void Fq_rawNegLS(FqRawElement pRawResult, FqRawElement pRawA, uint64_t rawB)
{
    uint64_t carry1 = mpn_sub_1(GMP_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64, rawB);
    uint64_t carry2 = mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(pRawA), Fq_N64);

    if (carry1 || carry2)
    {
        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawCopy(FqRawElement pRawResult, const FqRawElement pRawA)
{
    pRawResult[0] = pRawA[0];
    pRawResult[1] = pRawA[1];
    pRawResult[2] = pRawA[2];
    pRawResult[3] = pRawA[3];
}

int Fq_rawIsEq(const FqRawElement pRawA, const FqRawElement pRawB)
{
    return mpn_cmp(GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fq_N64) == 0;
}

void Fq_rawMMul(FqRawElement pRawResult, const FqRawElement pRawA, const FqRawElement pRawB)
{
    const mp_size_t  N = Fq_N64+1;
    const uint64_t  *mq = Fq_rawq;

    uint64_t  np0;

    uint64_t  product0[N] = {0};
    uint64_t  product1[N] = {0};
    uint64_t  product2[N] = {0};
    uint64_t  product3[N] = {0};

    product0[4] = mpn_mul_1(GMP_CAST(product0), GMP_CONST_CAST(pRawB), Fq_N64, pRawA[0]);

    np0 = Fq_np * product0[0];
    product1[1] = mpn_addmul_1(GMP_CAST(product0), GMP_CONST_CAST(mq), N, np0);

    product1[4] = mpn_addmul_1(GMP_CAST(product1), GMP_CONST_CAST(pRawB), Fq_N64, pRawA[1]);
    mpn_add(GMP_CAST(product1), GMP_CONST_CAST(product1), N, GMP_CONST_CAST(product0+1), N-1);

    np0 = Fq_np * product1[0];
    product2[1] = mpn_addmul_1(GMP_CAST(product1), GMP_CONST_CAST(mq), N, np0);

    product2[4] = mpn_addmul_1(GMP_CAST(product2), GMP_CONST_CAST(pRawB), Fq_N64, pRawA[2]);
    mpn_add(GMP_CAST(product2), GMP_CONST_CAST(product2), N, GMP_CONST_CAST(product1+1), N-1);

    np0 = Fq_np * product2[0];
    product3[1] = mpn_addmul_1(GMP_CAST(product2), GMP_CONST_CAST(mq), N, np0);

    product3[4] = mpn_addmul_1(GMP_CAST(product3), GMP_CONST_CAST(pRawB), Fq_N64, pRawA[3]);
    mpn_add(GMP_CAST(product3), GMP_CONST_CAST(product3), N, GMP_CONST_CAST(product2+1), N-1);

    np0 = Fq_np * product3[0];
    mpn_addmul_1(GMP_CAST(product3), GMP_CONST_CAST(mq), N, np0);

    mpn_copyi(GMP_CAST(pRawResult), GMP_CONST_CAST(product3+1), Fq_N64);

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fq_N64);
    }
}

void Fq_rawMMul1(FqRawElement pRawResult, const FqRawElement pRawA, uint64_t pRawB)
{
    const mp_size_t  N = Fq_N64+1;
    const uint64_t  *mq = Fq_rawq;

    uint64_t  np0;

    uint64_t  product0[N] = {0};
    uint64_t  product1[N] = {0};
    uint64_t  product2[N] = {0};
    uint64_t  product3[N] = {0};

    product0[4] = mpn_mul_1(GMP_CAST(product0), GMP_CONST_CAST(pRawA), Fq_N64, pRawB);

    np0 = Fq_np * product0[0];
    product1[1] = mpn_addmul_1(GMP_CAST(product0), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product1), GMP_CONST_CAST(product1), N, GMP_CONST_CAST(product0+1), N-1);

    np0 = Fq_np * product1[0];
    product2[1] = mpn_addmul_1(GMP_CAST(product1), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product2), GMP_CONST_CAST(product2), N, GMP_CONST_CAST(product1+1), N-1);

    np0 = Fq_np * product2[0];
    product3[1] = mpn_addmul_1(GMP_CAST(product2), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product3), GMP_CONST_CAST(product3), N, GMP_CONST_CAST(product2+1), N-1);

    np0 = Fq_np * product3[0];
    mpn_addmul_1(GMP_CAST(product3), GMP_CONST_CAST(mq), N, np0);

    mpn_copyi(GMP_CAST(pRawResult), GMP_CONST_CAST(product3+1), Fq_N64);

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fq_N64);
    }
}

void Fq_rawFromMontgomery(FqRawElement pRawResult, const FqRawElement &pRawA)
{
    const mp_size_t  N = Fq_N64+1;
    const uint64_t  *mq = Fq_rawq;

    uint64_t  np0;

    uint64_t  product0[N];
    uint64_t  product1[N] = {0};
    uint64_t  product2[N] = {0};
    uint64_t  product3[N] = {0};

    mpn_copyi(GMP_CAST(product0), GMP_CONST_CAST(pRawA), Fq_N64); product0[4] = 0;

    np0 = Fq_np * product0[0];
    product1[1] = mpn_addmul_1(GMP_CAST(product0), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product1), GMP_CONST_CAST(product1), N, GMP_CONST_CAST(product0+1), N-1);

    np0 = Fq_np * product1[0];
    product2[1] = mpn_addmul_1(GMP_CAST(product1), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product2), GMP_CONST_CAST(product2), N, GMP_CONST_CAST(product1+1), N-1);

    np0 = Fq_np * product2[0];
    product3[1] = mpn_addmul_1(GMP_CAST(product2), GMP_CONST_CAST(mq), N, np0);
    mpn_add(GMP_CAST(product3), GMP_CONST_CAST(product3), N, GMP_CONST_CAST(product2+1), N-1);

    np0 = Fq_np * product3[0];
    mpn_addmul_1(GMP_CAST(product3), GMP_CONST_CAST(mq), N, np0);

    mpn_copyi(GMP_CAST(pRawResult), GMP_CONST_CAST(product3+1), Fq_N64);

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(mq), Fq_N64);
    }
}

int Fq_rawIsZero(const FqRawElement rawA)
{
    return mpn_zero_p(GMP_CONST_CAST(rawA), Fq_N64) ? 1 : 0;
}

int Fq_rawCmp(FqRawElement pRawA, FqRawElement pRawB)
{
    return mpn_cmp(GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fq_N64);
}

void Fq_rawSwap(FqRawElement pRawResult, FqRawElement pRawA)
{
    FqRawElement temp;

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

void Fq_rawCopyS2L(FqRawElement pRawResult, int64_t val)
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

        mpn_add_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}


void Fq_rawAnd(FqRawElement pRawResult, FqRawElement pRawA, FqRawElement pRawB)
{
    mpn_and_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fq_N64);

    pRawResult[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawOr(FqRawElement pRawResult, FqRawElement pRawA, FqRawElement pRawB)
{
    mpn_ior_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fq_N64);

    pRawResult[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawXor(FqRawElement pRawResult, FqRawElement pRawA, FqRawElement pRawB)
{
    mpn_xor_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), GMP_CONST_CAST(pRawB), Fq_N64);

    pRawResult[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawShl(FqRawElement r, FqRawElement a, uint64_t b)
{
    uint64_t bit_shift  = b % 64;
    uint64_t word_shift = b / 64;
    uint64_t word_count = Fq_N64 - word_shift;

    mpn_copyi(GMP_CAST(r + word_shift), GMP_CONST_CAST(a), word_count);
    std::memset(r, 0, word_shift * sizeof(uint64_t));

    if (bit_shift)
    {
        mpn_lshift(GMP_CAST(r), GMP_CONST_CAST(r), Fq_N64, bit_shift);
    }

    r[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(r), GMP_CONST_CAST(Fq_rawq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(r), GMP_CONST_CAST(r), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}

void Fq_rawShr(FqRawElement r, FqRawElement a, uint64_t b)
{
    const uint64_t bit_shift  = b % 64;
    const uint64_t word_shift = b / 64;
    const uint64_t word_count = Fq_N64 - word_shift;

    mpn_copyi(GMP_CAST(r), GMP_CONST_CAST(a + word_shift), word_count);
    std::memset(r + word_count, 0, word_shift * sizeof(uint64_t));

    if (bit_shift)
    {
        mpn_rshift(GMP_CAST(r), GMP_CONST_CAST(r), Fq_N64, bit_shift);
    }
}

void Fq_rawNot(FqRawElement pRawResult, FqRawElement pRawA)
{
    mpn_com(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawA), Fq_N64);

    pRawResult[3] &= lboMask;

    if (mpn_cmp(GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64) >= 0)
    {
        mpn_sub_n(GMP_CAST(pRawResult), GMP_CONST_CAST(pRawResult), GMP_CONST_CAST(Fq_rawq), Fq_N64);
    }
}
