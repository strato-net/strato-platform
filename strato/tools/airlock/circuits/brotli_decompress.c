#include <stdio.h>
#include <stdlib.h>
#include <brotli/decode.h>

int main(int argc, char* argv[]) {
    if (argc != 3) {
        fprintf(stderr, "Usage: %s <input.br> <output>\n", argv[0]);
        return 1;
    }

    // Read input file
    FILE* fin = fopen(argv[1], "rb");
    if (!fin) {
        perror("Cannot open input file");
        return 1;
    }
    
    fseek(fin, 0, SEEK_END);
    size_t input_size = ftell(fin);
    fseek(fin, 0, SEEK_SET);
    
    uint8_t* input = malloc(input_size);
    if (!input) {
        fclose(fin);
        fprintf(stderr, "Memory allocation failed\n");
        return 1;
    }
    
    if (fread(input, 1, input_size, fin) != input_size) {
        free(input);
        fclose(fin);
        fprintf(stderr, "Failed to read input file\n");
        return 1;
    }
    fclose(fin);

    // Estimate output size (circuits are typically ~10-20x larger)
    size_t output_size = input_size * 25;
    uint8_t* output = malloc(output_size);
    if (!output) {
        free(input);
        fprintf(stderr, "Memory allocation failed\n");
        return 1;
    }

    // Decompress
    BrotliDecoderResult result = BrotliDecoderDecompress(
        input_size, input,
        &output_size, output
    );

    free(input);

    if (result != BROTLI_DECODER_RESULT_SUCCESS) {
        free(output);
        fprintf(stderr, "Decompression failed: %d\n", result);
        return 1;
    }

    // Write output file
    FILE* fout = fopen(argv[2], "wb");
    if (!fout) {
        free(output);
        perror("Cannot open output file");
        return 1;
    }
    
    if (fwrite(output, 1, output_size, fout) != output_size) {
        free(output);
        fclose(fout);
        fprintf(stderr, "Failed to write output file\n");
        return 1;
    }
    
    fclose(fout);
    free(output);
    
    printf("Decompressed %zu bytes to %zu bytes\n", input_size, output_size);
    return 0;
}
