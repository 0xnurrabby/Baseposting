import { Attribution } from "https://esm.sh/ox/erc8021";

const BUILDER_CODE = "TODO_REPLACE_BUILDER_CODE";

const dataSuffix = Attribution.toDataSuffix({
  codes: [BUILDER_CODE]
});

globalThis.__bp_dataSuffix = dataSuffix;

export { dataSuffix, BUILDER_CODE };
