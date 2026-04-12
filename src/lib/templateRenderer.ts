// ─── Template Renderer ────────────────────────────────────────────────────────
// Renders MJML templates with variable interpolation.
// MJML compiles to responsive HTML — great for transactional emails.

import mjml2html from 'mjml'

/**
 * Interpolate {{variable}} placeholders in a template string.
 */
export function interpolate(template: string, variables: Record<string, string> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return variables[key] ?? `{{${key}}}`
  })
}

/**
 * Render an MJML template string to HTML.
 * Falls back to raw HTML if the template doesn't start with <mjml>.
 */
export function renderTemplate(
  mjmlOrHtml: string,
  variables: Record<string, string> = {},
): { html: string; errors: string[] } {
  // Interpolate variables first
  const interpolated = interpolate(mjmlOrHtml, variables)

  // If it's MJML, compile it
  if (interpolated.trimStart().startsWith('<mjml')) {
    const result = mjml2html(interpolated, { validationLevel: 'soft' })
    return {
      html: result.html,
      errors: result.errors.map((e) => e.formattedMessage),
    }
  }

  // Otherwise treat as raw HTML
  return { html: interpolated, errors: [] }
}

// ─── Built-in OTP Template ────────────────────────────────────────────────────

export const OTP_TEMPLATE = `
<mjml>
  <mj-head>
    <mj-title>Your verification code</mj-title>
    <mj-attributes>
      <mj-all font-family="Inter, Arial, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f5">
    <mj-section padding="40px 0 0">
      <mj-column>
        <mj-text align="center" font-size="24px" font-weight="700" color="#18181b">
          {{appName}}
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="12px" padding="40px" margin="20px">
      <mj-column>
        <mj-text font-size="18px" font-weight="600" color="#18181b">
          Your verification code
        </mj-text>
        <mj-text font-size="14px" color="#71717a" line-height="1.6">
          Hi {{name}}, use the code below to verify your identity. It expires in {{expiresIn}}.
        </mj-text>
        <mj-text align="center" font-size="40px" font-weight="700" color="#18181b"
          letter-spacing="8px" padding="24px 0">
          {{otp}}
        </mj-text>
        <mj-divider border-color="#e4e4e7" />
        <mj-text font-size="12px" color="#a1a1aa" align="center">
          If you didn't request this, you can safely ignore this email.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="20px 0 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#a1a1aa">
          Sent via Senviok · Reliable email for African builders
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`

export const WELCOME_TEMPLATE = `
<mjml>
  <mj-head>
    <mj-title>Welcome to {{appName}}</mj-title>
    <mj-attributes>
      <mj-all font-family="Inter, Arial, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f5">
    <mj-section padding="40px 0 0">
      <mj-column>
        <mj-text align="center" font-size="24px" font-weight="700" color="#18181b">
          {{appName}}
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="12px" padding="40px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" color="#18181b">
          Welcome, {{name}} 👋
        </mj-text>
        <mj-text font-size="14px" color="#71717a" line-height="1.6">
          {{message}}
        </mj-text>
        <mj-button background-color="#18181b" color="#ffffff" border-radius="8px"
          href="{{ctaUrl}}" font-size="14px" padding="14px 28px">
          {{ctaText}}
        </mj-button>
      </mj-column>
    </mj-section>
    <mj-section padding="20px 0 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#a1a1aa">
          Sent via Senviok · Reliable email for African builders
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`
