"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseConfiguration } from "../environment";

export function createBrowserSupabaseClient() {
  const configuration = getPublicSupabaseConfiguration();
  if (!configuration) {
    throw new Error("SUPABASE_CONFIGURATION_MISSING");
  }
  return createBrowserClient(
    configuration.url,
    configuration.publishableKey
  );
}
