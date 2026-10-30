const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { plan } = require('../scripts/nativeBridgeConfigure');

describe('Native rollout configuration', function () {
  it('generates executable Safe batches and no duplicate configuration on rerun', async function () {
    const [safe, executor, eabExecutor, s1, s2, strato] = await ethers.getSigners();
    const bridge = await upgrades.deployProxy(await ethers.getContractFactory('StratoNativeRepresentationBridge'), [safe.address], { kind:'uups' });
    const token = await upgrades.deployProxy(await ethers.getContractFactory('StratoNativeRepresentationToken'), ['Test','TEST',safe.address], { kind:'uups' });
    const config = { chainId:31337, bridgeAddress:await bridge.getAddress(), safeAddress:safe.address,
      maxAttestationValiditySeconds:"1800", executor:executor.address, eabExecutor:eabExecutor.address, attestationSigners:[s1.address,s2.address], disabledAttestationSigners:[], attestationThreshold:2,
      tokens:[{ stratoToken:strato.address, representationToken:await token.getAddress(), freezeRoute:true, transfersEnabled:false }] };
    await expect(plan(config, ethers.provider, 'activate')).to.be.rejectedWith('configuration actions remain');
    const first = await plan(config, ethers.provider);
    expect(first.transactions.length).to.be.greaterThan(0);
    for (const tx of first.transactions) await (await safe.sendTransaction(tx)).wait();
    expect((await plan(config, ethers.provider)).transactions).to.have.length(0);
    const activation = await plan(config, ethers.provider, 'activate');
    for (const tx of activation.transactions) await (await safe.sendTransaction(tx)).wait();
    expect((await plan(config, ethers.provider, 'verify')).transactions).to.have.length(0);
    expect(await bridge.stratoToRepresentation(strato.address)).to.equal(await token.getAddress());
    await expect(plan({ ...config, executor:eabExecutor.address }, ethers.provider)).to.be.rejectedWith('distinct');
    await expect(plan({ ...config, tokens:[{ ...config.tokens[0], freezeRoute:false }] }, ethers.provider)).to.be.rejectedWith('unfreeze');
  });
});
