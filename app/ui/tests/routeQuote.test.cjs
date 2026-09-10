const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, QueryObserver, keepPreviousData } = require('@tanstack/react-query');

for (const [name, inputs] of [
  ['useRouteQuote', { tokenIn: 'in', tokenOut: 'out', amountWei: '1', slippageBps: 50 }],
  ['useCompositeRouteQuote', { externalChainId: '1', externalToken: 'external',
    targetStratoToken: 'bridge', tokenOut: 'out', amountWei: '1', slippageBps: 50 }],
]) {
  test(`${name} never exposes a quote for previous inputs`, () => {
    const client = new QueryClient();
    let observer, unsubscribe;
    let debounced = '1';
    const exports = {};
    const source = fs.readFileSync(path.join(__dirname, `../src/hooks/trade/${name}.ts`), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, {
      exports,
      require: (id) => {
        if (id === '@/hooks/useDebouncedValue') return { useDebouncedValue: () => debounced };
        if (id === '@/lib/axios') return { api: {} };
        assert.equal(id, '@tanstack/react-query');
        return { keepPreviousData, useQuery: (options) => {
          options = { ...options, enabled: false };
          if (!observer) {
            client.setQueryData(options.queryKey, { minFinalOut: '99' });
            observer = new QueryObserver(client, options);
            unsubscribe = observer.subscribe(() => {});
          } else observer.setOptions(options);
          return observer.getCurrentResult();
        } };
      },
    });
    const hook = exports[name];
    try {
      assert.equal(hook(inputs).data.minFinalOut, '99');
      // The old query is still current during debounce, but its data must be hidden.
      assert.equal(hook({ ...inputs, amountWei: '100' }).data, undefined);
      debounced = '100';
      assert.equal(hook({ ...inputs, amountWei: '100' }).data, undefined);
      debounced = '1';
      assert.equal(hook(inputs).data.minFinalOut, '99');
      for (const key of Object.keys(inputs).filter((key) => key !== 'amountWei')) {
        const result = hook({ ...inputs, [key]: key === 'slippageBps' ? 100 : 'different' });
        assert.equal(result.isPlaceholderData, true);
        assert.equal(result.data, undefined, key);
        assert.equal(hook(inputs).data.minFinalOut, '99');
      }
    } finally {
      unsubscribe?.();
      observer?.destroy();
      client.clear();
    }
  });
}
