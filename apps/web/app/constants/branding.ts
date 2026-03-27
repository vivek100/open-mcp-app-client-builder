const DEFAULT_DOCS_URL = "https://docs.copilotkit.ai/";
const DEFAULT_SECONDARY_URL = "https://github.com/CopilotKit/CopilotKit";
const DEFAULT_SECONDARY_LABEL = "GitHub";

/** Header / logo primary link — CopilotKit docs by default. */
export function getHeaderDocsUrl(): string {
  const fromEnv =
    typeof process.env.NEXT_PUBLIC_HEADER_DOCS_URL === "string"
      ? process.env.NEXT_PUBLIC_HEADER_DOCS_URL.trim()
      : "";
  return fromEnv || DEFAULT_DOCS_URL;
}

/** Second header pill (e.g. repo, demo). */
export function getHeaderSecondaryCtaUrl(): string {
  const primary =
    typeof process.env.NEXT_PUBLIC_HEADER_SECONDARY_CTA_URL === "string"
      ? process.env.NEXT_PUBLIC_HEADER_SECONDARY_CTA_URL.trim()
      : "";
  if (primary) return primary;
  const legacyGithub =
    typeof process.env.NEXT_PUBLIC_GITHUB_REPO_URL === "string"
      ? process.env.NEXT_PUBLIC_GITHUB_REPO_URL.trim()
      : "";
  return legacyGithub || DEFAULT_SECONDARY_URL;
}

export function getHeaderSecondaryCtaLabel(): string {
  const fromEnv =
    typeof process.env.NEXT_PUBLIC_HEADER_SECONDARY_CTA_LABEL === "string"
      ? process.env.NEXT_PUBLIC_HEADER_SECONDARY_CTA_LABEL.trim()
      : "";
  return fromEnv || DEFAULT_SECONDARY_LABEL;
}

const DEFAULT_PRIMARY_LABEL = "CopilotKit docs";

export function getHeaderPrimaryCtaLabel(): string {
  const fromEnv =
    typeof process.env.NEXT_PUBLIC_HEADER_PRIMARY_CTA_LABEL === "string"
      ? process.env.NEXT_PUBLIC_HEADER_PRIMARY_CTA_LABEL.trim()
      : "";
  return fromEnv || DEFAULT_PRIMARY_LABEL;
}
