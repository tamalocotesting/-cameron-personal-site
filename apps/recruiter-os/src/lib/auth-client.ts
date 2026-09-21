'use client';
import { createAuthClient } from 'better-auth/react';
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  plugins: [organizationClient(), twoFactorClient()],
});

export const { signIn, signOut, useSession } = authClient;
