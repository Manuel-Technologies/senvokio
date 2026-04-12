// ─── Template Renderer Tests ──────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { interpolate, renderTemplate } from '../src/lib/templateRenderer'

describe('interpolate', () => {
  it('replaces known variables', () => {
    const result = interpolate('Hello {{name}}!', { name: 'Chidi' })
    expect(result).toBe('Hello Chidi!')
  })

  it('leaves unknown variables as-is', () => {
    const result = interpolate('Hello {{name}}!', {})
    expect(result).toBe('Hello {{name}}!')
  })

  it('handles multiple variables', () => {
    const result = interpolate('{{greeting}} {{name}}, your OTP is {{otp}}', {
      greeting: 'Hi',
      name: 'Amaka',
      otp: '123456',
    })
    expect(result).toBe('Hi Amaka, your OTP is 123456')
  })
})

describe('renderTemplate', () => {
  it('renders raw HTML as-is', () => {
    const { html, errors } = renderTemplate('<p>Hello {{name}}</p>', { name: 'Tunde' })
    expect(html).toBe('<p>Hello Tunde</p>')
    expect(errors).toHaveLength(0)
  })

  it('renders MJML to HTML', () => {
    const mjml = `
      <mjml>
        <mj-body>
          <mj-section>
            <mj-column>
              <mj-text>Hello {{name}}</mj-text>
            </mj-column>
          </mj-section>
        </mj-body>
      </mjml>
    `
    const { html, errors } = renderTemplate(mjml, { name: 'Ngozi' })
    expect(html).toContain('Hello Ngozi')
    expect(errors).toHaveLength(0)
  })
})
