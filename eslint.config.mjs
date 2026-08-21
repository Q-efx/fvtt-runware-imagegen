import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    // build/ is a generated copy of scripts/ (see build.mjs); linting it
    // duplicates every finding from scripts/ under a different path.
    ignores: ["build/"],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        // FoundryVTT v13/v14 runtime globals. This is plain ES modules
        // loaded directly by Foundry in the browser (see CLAUDE.md) - there
        // is no bundler step that would inject these, so eslint has no way
        // to know about them without this list. Foundry provides no official
        // eslint globals package, so this is maintained by hand; err on the
        // side of adding an entry that turns out unused over missing one
        // that's still referenced (a stray `no-undef` costs a moment to
        // read, a missed real bug does not).
        game: "readonly",
        ui: "readonly",
        Hooks: "readonly",
        foundry: "readonly",
        CONST: "readonly",
        CONFIG: "readonly",
        Actor: "readonly",
        FilePicker: "readonly",
        Setting: "readonly",
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // Foundry's ApplicationV2 callback signatures (e.g.
      // `_onSubmit(event, form, formData)`) require fixed parameter lists
      // even when a given handler doesn't use every parameter. Flagging
      // those as errors would mean either renaming/prefixing parameters
      // across call sites we don't own here, or living with permanent
      // noise. Unused local variables (the actual bug class this rule is
      // for) are still reported.
      "no-unused-vars": ["error", { args: "none" }],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
    },
  },
];
