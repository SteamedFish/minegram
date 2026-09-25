import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(() => {
  cleanup()
})

describe('App', () => {
  it('renders the Phase 0 foundation shell', () => {
    render(<App phaseLabel="Phase 0" />)

    expect(screen.getByRole('heading', { name: 'Minegram' })).toBeDefined()
    expect(screen.getByText('Project foundation is ready.')).toBeDefined()
  })
})
