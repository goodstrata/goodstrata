import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

/** Session cookies live in SecureStore; all calls hit the production API. */
export const authClient = createAuthClient({
  baseURL: "https://my.goodstrata.com.au",
  plugins: [
    expoClient({
      scheme: "goodstrata",
      storagePrefix: "goodstrata",
      storage: SecureStore,
    }),
  ],
});
