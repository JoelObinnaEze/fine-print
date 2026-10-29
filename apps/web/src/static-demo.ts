const buildEnvironment = (
  import.meta as ImportMeta & { readonly env?: Readonly<Record<string, string | boolean | undefined>> }
).env;

export const isStaticDemo = buildEnvironment?.VITE_STATIC_DEMO === "true";
