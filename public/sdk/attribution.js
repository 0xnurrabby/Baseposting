import { Attribution } from "https://esm.sh/ox/erc8021";

export function buildDataSuffix(builderCode) {
  if (!builderCode || builderCode === "TODO_REPLACE_BUILDER_CODE") return null;
  try {
    return Attribution.toDataSuffix({ codes: [builderCode] });
  } catch {
    return null;
  }
}
