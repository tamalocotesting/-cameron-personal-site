/** Types for site.config.mjs, so astro check covers the config the site reads. */
export declare const PRODUCTION_URL: string;
export declare function isProductionDeploy(env?: Record<string, string | undefined>): boolean;
export declare function resolveSiteUrl(env?: Record<string, string | undefined>): string;
