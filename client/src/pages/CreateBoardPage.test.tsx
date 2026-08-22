import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { SessionProvider } from '../lib/session'
import { CreateBoardPage } from './CreateBoardPage'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }
}

function mockApi({
  createStatus = 201,
  createBody = null,
}: { createStatus?: number; createBody?: unknown } = {}) {
  const fetchMock = vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/me' && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, { player: { id: 'p1', name: 'Ruth' } }),
        )
      }
      if (url === '/api/boards' && method === 'POST') {
        return Promise.resolve(jsonResponse(createStatus, createBody))
      }
      return Promise.resolve(
        jsonResponse(404, { code: 'unauthorized', error: 'nope' }),
      )
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// Lands where a successful print navigates, exposing the router state the
// real archive page reads for its "Board printed" toast.
function ArchiveProbe() {
  const { state } = useLocation() as { state: { printed?: string } | null }
  return <div>Archive probe{state?.printed ? ` — printed ${state.printed}` : ''}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/boards/new']}>
      <SessionProvider>
        <Routes>
          <Route path="/boards/new" element={<CreateBoardPage />} />
          <Route path="/boards" element={<ArchiveProbe />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )
}

const TERMS_LABEL = 'YOUR TERMS — ONE PER LINE'
const TERMS_8 = [
  'synergy',
  'circle back',
  'pivot',
  'deep dive',
  'offline',
  'bandwidth',
  'alignment',
  'touch base',
]

function fillName(name: string) {
  fireEvent.change(screen.getByLabelText('BOARD NAME'), {
    target: { value: name },
  })
}

function fillTerms(lines: string[]) {
  fireEvent.change(screen.getByLabelText(TERMS_LABEL), {
    target: { value: lines.join('\n') },
  })
}

function previewCells(): HTMLElement[] {
  return Array.from(screen.getByTestId('board-preview').children) as HTMLElement[]
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('create board page', () => {
  it('updates the term counter and preview dimensions when the size changes', () => {
    mockApi()
    renderPage()
    // Default selection is 5×5 → 24 terms, 25 cells.
    expect(screen.getByText(/0 \/ 24/)).toBeDefined()
    expect(previewCells()).toHaveLength(25)
    fireEvent.click(screen.getByRole('button', { name: /3×3/ }))
    expect(screen.getByText(/0 \/ 8/)).toBeDefined()
    expect(previewCells()).toHaveLength(9)
    fireEvent.click(screen.getByRole('button', { name: /4×4/ }))
    expect(screen.getByText(/0 \/ 15/)).toBeDefined()
    expect(previewCells()).toHaveLength(16)
  })

  it('keeps submit disabled until name and exact term count are present', () => {
    mockApi()
    renderPage()
    const submit = () =>
      screen.getByRole('button', { name: /Print it/ }) as HTMLButtonElement
    fireEvent.click(screen.getByRole('button', { name: /3×3/ }))
    expect(submit().disabled).toBe(true)
    fillName('Standup Standoff')
    expect(submit().disabled).toBe(true)
    fillTerms(TERMS_8.slice(0, 7))
    expect(submit().disabled).toBe(true)
    fillTerms(TERMS_8)
    expect(submit().disabled).toBe(false)
    fillTerms([...TERMS_8, 'one too many'])
    expect(submit().disabled).toBe(true)
  })

  it('fills the preview in order with FREE at the center', () => {
    mockApi()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /3×3/ }))
    fillTerms(['synergy', 'circle back', 'pivot'])
    expect(previewCells().map((c) => c.textContent)).toEqual([
      'synergy',
      'circle back',
      'pivot',
      '',
      'FREE',
      '',
      '',
      '',
      '',
    ])
  })

  it('POSTs the parsed payload and navigates to the archive on success', async () => {
    const fetchMock = mockApi({
      createBody: {
        board: {
          id: 'b1',
          name: 'Standup Standoff',
          size: 3,
          terms: TERMS_8,
          createdBy: 'p1',
          plays: 0,
          createdAt: '2026-08-22T12:00:00.000Z',
        },
      },
    })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /3×3/ }))
    fillName('  Standup Standoff  ')
    fillTerms(TERMS_8)
    fireEvent.click(screen.getByRole('button', { name: /Print it/ }))
    expect(
      await screen.findByText(/Archive probe — printed Standup Standoff/),
    ).toBeDefined()
    const post = fetchMock.mock.calls.find(
      (call) =>
        call[0] === '/api/boards' &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    )
    expect(post).toBeDefined()
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
      name: 'Standup Standoff', // trimmed by the schema before sending
      size: 3,
      terms: TERMS_8,
    })
  })

  it('blocks duplicate terms client-side without POSTing', async () => {
    const fetchMock = mockApi()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /3×3/ }))
    fillName('Standup Standoff')
    fillTerms([...TERMS_8.slice(0, 7), 'Synergy']) // dupe of 'synergy', case-insensitive
    fireEvent.click(screen.getByRole('button', { name: /Print it/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('duplicate')
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/boards',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces a server ApiError in the alert area', async () => {
    mockApi({
      createStatus: 400,
      createBody: { code: 'invalid_board', error: 'That board smells fishy.' },
    })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /3×3/ }))
    fillName('Standup Standoff')
    fillTerms(TERMS_8)
    fireEvent.click(screen.getByRole('button', { name: /Print it/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('fishy')
  })
})
