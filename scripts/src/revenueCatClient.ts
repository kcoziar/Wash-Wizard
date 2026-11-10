import { ReplitConnectors } from "@replit/connectors-sdk";
import { createClient } from "@replit/revenuecat-sdk/client";

/**
 * Returns a RevenueCat REST client authenticated through the Replit
 * RevenueCat connector. Never cache the result: the connector token can rotate.
 * Server-side scripts only. Never import this from the mobile app.
 */
export async function getUncachableRevenueCatClient() {
  const connectors = new ReplitConnectors();
  const proxyFetch = connectors.createProxyFetch("revenuecat");
  return createClient({
    baseUrl: "https://api.revenuecat.com/v2",
    fetch: proxyFetch,
  });
}
