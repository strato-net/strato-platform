declare module "json-bigint" {
  interface JSONBigOptions {
    strict?: boolean;
    storeAsString?: boolean;
    alwaysParseAsBig?: boolean;
    useNativeBigInt?: boolean;
    protoAction?: "error" | "ignore" | "preserve";
    constructorAction?: "error" | "ignore" | "preserve";
  }
  interface JSONBigApi {
    parse(text: string, reviver?: (key: string, value: unknown) => unknown): unknown;
    stringify(
      value: unknown,
      replacer?: ((key: string, value: unknown) => unknown) | Array<string | number> | null,
      space?: string | number
    ): string;
  }
  function JSONBig(options?: JSONBigOptions): JSONBigApi;
  export = JSONBig;
}
