import { addNetwork, walletError } from "./wallet.js";

const select = document.querySelector("#network-wallet");
const button = document.querySelector("#add-network");
const status = document.querySelector("#wallet-result");
const providers = [];
function offer(provider, name) {
  if (!provider || typeof provider.request !== "function" || providers.includes(provider) || providers.length >= 16) return;
  const option = document.createElement("option");
  option.value = String(providers.length);
  option.textContent = String(name || "Browser wallet").slice(0, 80);
  select.append(option);
  providers.push(provider);
  select.disabled = false;
}
window.addEventListener("eip6963:announceProvider", event => {
  offer(event.detail?.provider, event.detail?.info?.name);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
if (window.ethereum?.providers?.length) {
  for (const provider of window.ethereum.providers) offer(provider, "Browser wallet");
} else offer(window.ethereum, "Browser wallet");

button.addEventListener("click", async () => {
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = "Checking the network identity. Then approve adding and switching networks in your wallet.";
  try {
    await addNetwork(providers[Number(select.value)]);
    status.textContent = "Your wallet is connected to MFENX Native 2026 (2026092601).";
  } catch (error) { status.textContent = walletError(error); }
  finally { button.disabled = false; }
});
