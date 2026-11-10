import { getUncachableRevenueCatClient } from "./revenueCatClient";

import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

/**
 * Seeds RevenueCat for Pressure Washing Calculator+.
 * Idempotent: safe to run again. Run with:
 *   pnpm --filter @workspace/scripts exec tsx src/seedRevenueCat.ts
 */

const PROJECT_NAME = "Pressure Washing Calculator+";

const APP_STORE_APP_NAME = "Pressure Washing Calculator+ (iOS)";
const APP_STORE_BUNDLE_ID = "com.kozipublishing.pressurequote";
const PLAY_STORE_APP_NAME = "Pressure Washing Calculator+ (Android)";
const PLAY_STORE_PACKAGE_NAME = "com.kozipublishing.pressurequote";

const ENTITLEMENT_IDENTIFIER = "pro";
const ENTITLEMENT_DISPLAY_NAME = "Pro";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "Pro plans";

type Duration = "P1W" | "P1M" | "P2M" | "P3M" | "P6M" | "P1Y";

interface PlanSpec {
  storeIdentifier: string;
  playStoreIdentifier: string; // {subscriptionId}:{basePlanId}
  displayName: string;
  title: string;
  duration: Duration;
  packageIdentifier: string;
  packageDisplayName: string;
  prices: { amount_micros: number; currency: string }[];
}

const PLANS: PlanSpec[] = [
  {
    storeIdentifier: "pwc_pro_monthly",
    playStoreIdentifier: "pwc_pro_monthly:monthly",
    displayName: "Pro Monthly",
    title: "Pro Monthly",
    duration: "P1M",
    packageIdentifier: "$rc_monthly",
    packageDisplayName: "Monthly",
    prices: [{ amount_micros: 9_990_000, currency: "USD" }], // $9.99
  },
  {
    storeIdentifier: "pwc_pro_annual",
    playStoreIdentifier: "pwc_pro_annual:annual",
    displayName: "Pro Annual",
    title: "Pro Annual",
    duration: "P1Y",
    packageIdentifier: "$rc_annual",
    packageDisplayName: "Annual",
    prices: [{ amount_micros: 59_990_000, currency: "USD" }], // $59.99
  },
];

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  // Project
  let project: Project;
  const { data: existingProjects, error: listProjectsError } = await listProjects({
    client,
    query: { limit: 20 },
  });
  if (listProjectsError) throw new Error("Failed to list projects");
  const existingProject = existingProjects.items?.find((p) => p.name === PROJECT_NAME);
  if (existingProject) {
    console.log("Project already exists:", existingProject.id);
    project = existingProject;
  } else {
    const { data: newProject, error } = await createProject({ client, body: { name: PROJECT_NAME } });
    if (error) throw new Error("Failed to create project");
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  // Apps
  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listAppsError || !apps || apps.items.length === 0) throw new Error("No apps found");

  const testApp: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = apps.items.find((a) => a.type === "app_store");
  let playStoreApp: App | undefined = apps.items.find((a) => a.type === "play_store");
  if (!testApp) throw new Error("No app with test store found");
  console.log("App with test store found:", testApp.id);

  if (!appStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: { name: APP_STORE_APP_NAME, type: "app_store", app_store: { bundle_id: APP_STORE_BUNDLE_ID } },
    });
    if (error) throw new Error("Failed to create App Store app");
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app found:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: { name: PLAY_STORE_APP_NAME, type: "play_store", play_store: { package_name: PLAY_STORE_PACKAGE_NAME } },
    });
    if (error) throw new Error("Failed to create Play Store app");
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app found:", playStoreApp.id);
  }

  // Products
  const { data: existingProducts, error: listProductsError } = await listProducts({
    client,
    path: { project_id: project.id },
    query: { limit: 100 },
  });
  if (listProductsError) throw new Error("Failed to list products");

  const ensureProductForApp = async (
    targetApp: App,
    label: string,
    plan: PlanSpec,
    productIdentifier: string,
    isTestStore: boolean,
  ): Promise<Product> => {
    const existing = existingProducts.items?.find(
      (p) => p.store_identifier === productIdentifier && p.app_id === targetApp.id,
    );
    if (existing) {
      console.log(`${label} product ${productIdentifier} already exists:`, existing.id);
      return existing;
    }
    const body: CreateProductData["body"] = {
      store_identifier: productIdentifier,
      app_id: targetApp.id,
      type: "subscription",
      display_name: plan.displayName,
    };
    if (isTestStore) {
      body.subscription = { duration: plan.duration };
      body.title = plan.title;
    }
    const { data: created, error } = await createProduct({ client, path: { project_id: project.id }, body });
    if (error) throw new Error(`Failed to create ${label} product ${productIdentifier}`);
    console.log(`Created ${label} product ${productIdentifier}:`, created.id);
    return created;
  };

  const planProducts: { plan: PlanSpec; test: Product; appStore: Product; playStore: Product }[] = [];
  for (const plan of PLANS) {
    const test = await ensureProductForApp(testApp, "Test Store", plan, plan.storeIdentifier, true);
    const appStore = await ensureProductForApp(appStoreApp, "App Store", plan, plan.storeIdentifier, false);
    const playStore = await ensureProductForApp(playStoreApp, "Play Store", plan, plan.playStoreIdentifier, false);

    const { error: priceError } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: test.id },
      body: { prices: plan.prices },
    });
    if (priceError) {
      if (typeof priceError === "object" && priceError && "type" in priceError && priceError["type"] === "resource_already_exists") {
        console.log(`Test store prices already exist for ${plan.storeIdentifier}`);
      } else {
        console.error(priceError);
        throw new Error(`Failed to add test store prices for ${plan.storeIdentifier}`);
      }
    } else {
      console.log(`Added test store prices for ${plan.storeIdentifier}`);
    }
    planProducts.push({ plan, test, appStore, playStore });
  }

  // Entitlement
  let entitlement: Entitlement;
  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listEntitlementsError) throw new Error("Failed to list entitlements");
  const existingEntitlement = existingEntitlements.items?.find((e) => e.lookup_key === ENTITLEMENT_IDENTIFIER);
  if (existingEntitlement) {
    console.log("Entitlement already exists:", existingEntitlement.id);
    entitlement = existingEntitlement;
  } else {
    const { data: created, error } = await createEntitlement({
      client,
      path: { project_id: project.id },
      body: { lookup_key: ENTITLEMENT_IDENTIFIER, display_name: ENTITLEMENT_DISPLAY_NAME },
    });
    if (error) throw new Error("Failed to create entitlement");
    console.log("Created entitlement:", created.id);
    entitlement = created;
  }

  const allProductIds = planProducts.flatMap((p) => [p.test.id, p.appStore.id, p.playStore.id]);
  const { error: attachEntitlementError } = await attachProductsToEntitlement({
    client,
    path: { project_id: project.id, entitlement_id: entitlement.id },
    body: { product_ids: allProductIds },
  });
  if (attachEntitlementError) {
    if (attachEntitlementError.type === "unprocessable_entity_error") {
      console.log("Products already attached to entitlement");
    } else {
      throw new Error("Failed to attach products to entitlement");
    }
  } else {
    console.log("Attached products to entitlement");
  }

  // Offering
  let offering: Offering;
  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listOfferingsError) throw new Error("Failed to list offerings");
  const existingOffering = existingOfferings.items?.find((o) => o.lookup_key === OFFERING_IDENTIFIER);
  if (existingOffering) {
    console.log("Offering already exists:", existingOffering.id);
    offering = existingOffering;
  } else {
    const { data: created, error } = await createOffering({
      client,
      path: { project_id: project.id },
      body: { lookup_key: OFFERING_IDENTIFIER, display_name: OFFERING_DISPLAY_NAME },
    });
    if (error) throw new Error("Failed to create offering");
    console.log("Created offering:", created.id);
    offering = created;
  }
  if (!offering.is_current) {
    const { error } = await updateOffering({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: { is_current: true },
    });
    if (error) throw new Error("Failed to set offering as current");
    console.log("Set offering as current");
  }

  // Packages
  const { data: existingPackages, error: listPackagesError } = await listPackages({
    client,
    path: { project_id: project.id, offering_id: offering.id },
    query: { limit: 20 },
  });
  if (listPackagesError) throw new Error("Failed to list packages");

  for (const { plan, test, appStore, playStore } of planProducts) {
    let pkg: Package | undefined = existingPackages.items?.find((p) => p.lookup_key === plan.packageIdentifier);
    if (pkg) {
      console.log(`Package ${plan.packageIdentifier} already exists:`, pkg.id);
    } else {
      const { data: created, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: { lookup_key: plan.packageIdentifier, display_name: plan.packageDisplayName },
      });
      if (error) throw new Error(`Failed to create package ${plan.packageIdentifier}`);
      console.log(`Created package ${plan.packageIdentifier}:`, created.id);
      pkg = created;
    }

    const { error: attachPackageError } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: test.id, eligibility_criteria: "all" },
          { product_id: appStore.id, eligibility_criteria: "all" },
          { product_id: playStore.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPackageError) {
      if (
        attachPackageError.type === "unprocessable_entity_error" &&
        attachPackageError.message?.includes("Cannot attach product")
      ) {
        console.log(`Skipping attach for ${plan.packageIdentifier}: package already has a product for that app`);
      } else {
        throw new Error(`Failed to attach products to package ${plan.packageIdentifier}`);
      }
    } else {
      console.log(`Attached products to package ${plan.packageIdentifier}`);
    }
  }

  // Public API keys
  const keysFor = async (app: App, label: string) => {
    const { data, error } = await listAppPublicApiKeys({
      client,
      path: { project_id: project.id, app_id: app.id },
    });
    if (error) throw new Error(`Failed to list public API keys for ${label}`);
    return data?.items.map((item) => item.key).join(", ") ?? "N/A";
  };
  const testKeys = await keysFor(testApp, "Test Store app");
  const appStoreKeys = await keysFor(appStoreApp, "App Store app");
  const playStoreKeys = await keysFor(playStoreApp, "Play Store app");

  console.log("\n====================");
  console.log("RevenueCat setup complete!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", testApp.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("Entitlement Identifier:", ENTITLEMENT_IDENTIFIER);
  console.log("Public API Keys - Test Store:", testKeys);
  console.log("Public API Keys - App Store:", appStoreKeys);
  console.log("Public API Keys - Play Store:", playStoreKeys);
  console.log("====================\n");
}

seedRevenueCat().catch((err) => {
  console.error(err);
  process.exit(1);
});
