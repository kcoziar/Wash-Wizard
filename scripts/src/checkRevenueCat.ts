/**
 * Read-only check of the RevenueCat setup the iPhone app depends on. Changes nothing.
 * Run: pnpm --filter @workspace/scripts exec tsx src/checkRevenueCat.ts
 */
import {
  getApp,
  getProductsFromEntitlement,
  getProductsFromPackage,
  listAppPublicApiKeys,
  listEntitlements,
  listOfferings,
  listPackages,
  listProducts,
} from "@replit/revenuecat-sdk";
import { getUncachableRevenueCatClient } from "./revenueCatClient";

const PROJECT = process.env.REVENUECAT_PROJECT_ID!;
const APPLE_APP = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID!;
const TEST_APP = process.env.REVENUECAT_TEST_STORE_APP_ID!;
const WANT = { monthly: "pwc_pro_monthly", annual: "pwc_pro_annual" };
const problems: string[] = [];

async function main() {
  const client = await getUncachableRevenueCatClient();
  const project_id = PROJECT;

  const { data: app, error: appErr } = await getApp({ client, path: { project_id, app_id: APPLE_APP } });
  if (appErr || !app) throw new Error(`Apple app not found: ${JSON.stringify(appErr)}`);
  const bundle = (app as { app_store?: { bundle_id?: string } }).app_store?.bundle_id;
  console.log(`Apple app: ${app.name} (${app.type}), bundle ${bundle}`);
  if (bundle !== "com.kozipublishing.pressurequote") problems.push(`Apple app bundle ID is ${bundle}`);

  const { data: keys } = await listAppPublicApiKeys({ client, path: { project_id, app_id: APPLE_APP } });
  const appleKeys = (keys?.items ?? []).map((k) => k.key);
  const envKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? "";
  const matches = appleKeys.includes(envKey);
  console.log(`Apple public SDK keys: ${appleKeys.length}; app's EXPO_PUBLIC_REVENUECAT_IOS_API_KEY starts appl_: ${envKey.startsWith("appl_")}; matches this Apple app: ${matches}`);
  if (!matches) problems.push("EXPO_PUBLIC_REVENUECAT_IOS_API_KEY does not match the Apple app's public key");

  const { data: products } = await listProducts({ client, path: { project_id }, query: { limit: 50 } });
  const all = products?.items ?? [];
  const apple = all.filter((p) => p.app_id === APPLE_APP);
  console.log(`Products: ${all.length} total; Apple: ${apple.map((p) => `${p.store_identifier} [${p.type}]`).join(", ")}`);
  for (const id of Object.values(WANT)) {
    const n = apple.filter((p) => p.store_identifier === id).length;
    if (n !== 1) problems.push(`Apple product ${id} appears ${n} times`);
  }

  const { data: ents } = await listEntitlements({ client, path: { project_id }, query: { limit: 20 } });
  console.log(`Entitlements: ${(ents?.items ?? []).map((e) => e.lookup_key).join(", ")}`);
  const pro = ents?.items?.find((e) => e.lookup_key === "pro");
  if (!pro) problems.push("No entitlement with identifier pro");
  else {
    const { data: ep } = await getProductsFromEntitlement({ client, path: { project_id, entitlement_id: pro.id } });
    const ids = (ep?.items ?? []).filter((p) => p.app_id === APPLE_APP).map((p) => p.store_identifier);
    console.log(`pro unlocks (Apple): ${ids.join(", ")}`);
    for (const id of Object.values(WANT)) if (!ids.includes(id)) problems.push(`${id} does not grant pro`);
  }

  const { data: offs } = await listOfferings({ client, path: { project_id }, query: { limit: 20 } });
  const current = offs?.items?.find((o) => o.is_current);
  console.log(`Offerings: ${(offs?.items ?? []).map((o) => `${o.lookup_key}${o.is_current ? " (current)" : ""}`).join(", ")}`);
  if (!current) problems.push("No current offering");
  else {
    const { data: pkgs } = await listPackages({ client, path: { project_id, offering_id: current.id }, query: { limit: 20 } });
    for (const pkg of pkgs?.items ?? []) {
      const { data: pp } = await getProductsFromPackage({ client, path: { project_id, package_id: pkg.id } });
      const byStore = (pp?.items ?? []).map((x) => {
        const p = all.find((q) => q.id === x.product.id);
        const store = p?.app_id === APPLE_APP ? "Apple" : p?.app_id === TEST_APP ? "Test Store" : "Google";
        return `${store}:${p?.store_identifier}`;
      });
      console.log(`  ${pkg.lookup_key}: ${byStore.join(", ")}`);
    }
    const look = (k: string) => pkgs?.items?.find((p) => p.lookup_key === k);
    for (const [k, id] of [["$rc_monthly", WANT.monthly], ["$rc_annual", WANT.annual]] as const) {
      const pkg = look(k);
      if (!pkg) {
        problems.push(`Current offering has no ${k} package`);
        continue;
      }
      const { data: pp } = await getProductsFromPackage({ client, path: { project_id, package_id: pkg.id } });
      const ok = (pp?.items ?? []).some((x) => all.find((q) => q.id === x.product.id && q.app_id === APPLE_APP && q.store_identifier === id));
      if (!ok) problems.push(`${k} is not connected to Apple product ${id}`);
    }
  }

  if (problems.length) {
    console.error("\nProblems:\n" + problems.map((p) => `  x ${p}`).join("\n"));
    process.exitCode = 1;
  } else console.log("\nRevenueCat setup matches what the app expects.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
