/**
 * Better-Auth client. Used by the sign-in page (GitHub / passkey)
 * and the user menu (sign-out). Talks to the backend's /api/auth/*
 * surface across origin, so we send credentials.
 */
"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { BACKEND_URL } from "./env";

export const authClient = createAuthClient({
  baseURL: BACKEND_URL,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [passkeyClient()],
});

export const { useSession, signIn, signOut, signUp } = authClient;
