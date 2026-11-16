(() => {
  const mainnet = {
    chainId: "0x7030addddcf2",
    chainName: "STRATO",
    nativeCurrency: { name: "USDST", symbol: "USDST", decimals: 18 },
    rpcUrls: ["https://noderpc.strato.nexus/rpc", "https://app.strato.nexus/rpc"],
    blockExplorerUrls: ["https://stratoscan.strato.nexus"],
  };

  let metaMaskProvider;
  let pending = false;
  let message = "";

  window.addEventListener("eip6963:announceProvider", (event) => {
    if (
      event.detail?.info?.rdns === "io.metamask" &&
      typeof event.detail.provider?.request === "function"
    ) {
      metaMaskProvider = event.detail.provider;
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  function render() {
    const button = document.getElementById("add-strato-network");
    const status = document.getElementById("add-strato-network-status");
    if (!button || !status) return;

    button.disabled = pending;
    button.textContent = pending ? "Confirm in MetaMask…" : "Add STRATO to MetaMask";
    button.setAttribute("aria-busy", String(pending));
    button.onclick = addNetwork;
    status.textContent = message;
  }

  async function addNetwork() {
    if (pending) return;

    const ethereum = window.ethereum;
    const provider = metaMaskProvider ||
      ethereum?.providers?.find((candidate) => candidate.isMetaMask) ||
      (ethereum?.isMetaMask ? ethereum : null);

    if (typeof provider?.request !== "function") {
      message = "MetaMask was not detected. Install MetaMask or open this page in its mobile browser, or use the manual settings below.";
      render();
      return;
    }

    pending = true;
    message = "Approve the request in MetaMask to add STRATO mainnet.";
    render();

    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [mainnet],
      });
      message = "STRATO is available in MetaMask. Select it from MetaMask's network menu.";
    } catch (error) {
      if (error?.code === 4001) {
        message = "Request canceled. You can try again when you are ready.";
      } else if (error?.code === -32002) {
        message = "MetaMask already has a pending request. Open MetaMask to finish it, then try again.";
      } else {
        message = "MetaMask could not add STRATO. Try again or add it manually using the settings below.";
      }
    } finally {
      pending = false;
      render();
    }
  }

  document$.subscribe(render);
})();
