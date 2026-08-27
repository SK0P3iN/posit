/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAAS_BFF_URL?: string;
  readonly SAAS_BFF_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
