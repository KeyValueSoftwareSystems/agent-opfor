export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Types allowed in this repo (from CONTRIBUTING.md)
    "type-enum": [2, "always", ["feat", "fix", "docs", "refactor", "test", "chore", "perf"]],
    // Subject must not end with a period
    "subject-full-stop": [2, "never", "."],
    // Subject must start lowercase
    "subject-case": [2, "always", "lower-case"],
    // Header max length
    "header-max-length": [2, "always", 100],
    // Body must have blank line before it
    "body-leading-blank": [1, "always"],
    // Footer must have blank line before it
    "footer-leading-blank": [1, "always"],
  },
};
