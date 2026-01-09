import { Attribution } from "https://esm.sh/ox/erc8021";

const BUILDER_CODE = "bc_vh4m5q9p";

const dataSuffix = Attribution.toDataSuffix({
  codes: [BUILDER_CODE]
});

// Expose on window for the app to pass into wallet capabilities.
// @ts-ignore
window.__ERC8021_DATA_SUFFIX__ = dataSuffix;
