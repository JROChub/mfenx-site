/* Preserve explicit research deep links while keeping the product root stable. */
(() => {
  const current = new URL(window.location.href);
  if (current.pathname !== "/" && current.pathname !== "/index.html") return;
  const researchFragments = new Set(["#sfcs", "#sfcs-run", "#verify"]);
  const researchParameters = ["mode", "city", "time", "panel", "verify", "portal"];
  if (!researchFragments.has(current.hash) &&
      !researchParameters.some((name) => current.searchParams.has(name))) return;
  // The destination is a fixed path on this origin, never a query-supplied URL.
  current.pathname = "/labs/";
  window.location.replace(current.href);
})();
