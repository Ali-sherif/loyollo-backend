/**
 * Preserve campaign personalization tokens:
 * `{{name}}`, `{{first_name}}`, `{{business_name}}`
 */
export function personalize(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => ctx[key] ?? "");
}
