import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { API_ORIGIN } from "./config";

/** Session cookies live in SecureStore; all calls hit the production API. */
export const authClient = createAuthClient({
  baseURL: API_ORIGIN,
  plugins: [
    expoClient({
      scheme: "goodstrata",
      storagePrefix: "goodstrata",
      storage: SecureStore,
    }),
  ],
});
