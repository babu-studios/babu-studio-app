// Barrel for the AI highlight provider split: network I/O lives in
// highlights/highlights-client.ts, pure parsing/validation in
// highlights/highlight-suggestions.ts. Import paths are unchanged.
export {
  HIGHLIGHTS_MODEL_ID,
  HIGHLIGHTS_API_BASE,
  HIGHLIGHTS_ENV_VAR,
  getModelApiKey,
  setModelApiKeyResolver,
  metaHighlightsProvider,
  type HighlightsProvider,
} from "./highlights/highlights-client";
export {
  parseHighlightSuggestions,
  highlightFileName,
} from "./highlights/highlight-suggestions";
