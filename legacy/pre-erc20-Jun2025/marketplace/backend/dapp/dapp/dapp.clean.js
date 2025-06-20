import { replaceInFiles } from './dapp.helper.js';

describe('dapp.clean.js', function () {
  it('Revert imports back to <BASE_CODE_COLLECTION>', async () => {
    const pattern = /(import <[0-9a-fA-F]{40}>)/;
    replaceInFiles('./dapp/', pattern, 'import <BASE_CODE_COLLECTION>');
  });
});
