/* Keep saved research links working alongside the Power House product page. */
(() => {
  const current = new URL(window.location.href);
  if (!["/power-house/", "/power-house/index.html"].includes(current.pathname)) return;
  const researchFragments = new Set(["#sfcs", "#sfcs-run", "#verify"]);
  const researchParameters = ["mode", "city", "time", "panel", "verify", "portal"];
  if (!researchFragments.has(current.hash) &&
      !researchParameters.some((name) => current.searchParams.has(name))) return;
  // Retain query and fragment data, but never accept a destination from them.
  current.pathname = "/labs/";
  window.location.replace(current.href);
})();
