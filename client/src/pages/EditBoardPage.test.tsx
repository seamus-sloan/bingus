import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Board } from '@bingus/shared'
import { SessionProvider } from '../lib/session'
import { EditBoardPage } from './EditBoardPage'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }
}

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

const BOARD: Board = {
  id: 'board-7',
  name: 'Retro Bingo',
  size: 3,
  terms: TERMS_8,
  createdBy: 'Ruth',
  plays: 4,
  createdAt: '2026-08-01T00:00:00.000Z',
}

function mockApi({
  getStatus = 200,
  getBody = { board: BOARD },
  patchStatus = 200,
  patchBody = { board: BOARD },
}: {
  getStatus?: number
  getBody?: unknown
  patchStatus?: number
  patchBody?: unknown
} = {}) {
  const fetchMock = vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/me' && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, { player: { id: 'p1', name: 'Ruth' } }),
        )
      }
      if (url === `/api/boards/${BOARD.id}` && method === 'GET') {
        return Promise.resolve(jsonResponse(getStatus, getBody))
      }
      if (url === `/api/boards/${BOARD.id}` && method === 'PATCH') {
        return Promise.resolve(jsonResponse(patchStatus, patchBody))
      }
      return Promise.resolve(
        jsonResponse(404, { code: 'not_found', error: 'nope' }),
      )
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// Lands where a successful reprint navigates, exposing the router state the
// real archive page reads for its "Board printed" toast.
function ArchiveProbe() {
  const { state } = useLocation() as { state: { printed?: string } | null }
  return <div>Archive probe{state?.printed ? ` — printed ${state.printed}` : ''}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/boards/${BOARD.id}/edit`]}>
      <SessionProvider>
        <Routes>
          <Route path="/boards/:id/edit" element={<EditBoardPage />} />
          <Route path="/boards" element={<ArchiveProbe />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('edit board page', () => {
  it('shows the fetching line, then prefills the form from the board', async () => {
    mockApi()
    renderPage()
    expect(screen.getByText('Fetching the board…')).toBeDefined()
    expect(
      await screen.findByRole('heading', { name: 'Reprint Retro Bingo' }),
    ).toBeDefined()
    expect(
      (screen.getByLabelText('BOARD NAME') as HTMLInputElement).value,
    ).toBe('Retro Bingo')
    expect(
      (screen.getByLabelText('YOUR WORD BANK — ONE PER LINE') as HTMLTextAreaElement)
        .value,
    ).toBe(TERMS_8.join('\n'))
    // The board's size arrives selected.
    expect(
      screen.getByRole('button', { name: /3×3 ✓/ }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('shows a message and a back button when the board fails to load', async () => {
    mockApi({
      getStatus: 404,
      getBody: { code: 'not_found', error: 'no such board' },
    })
    renderPage()
    expect(
      await screen.findByText(/That board isn't in the archive/),
    ).toBeDefined()
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to the archive' }),
    )
    expect(await screen.findByText(/Archive probe/)).toBeDefined()
  })

  it('PATCHes the edited payload and navigates to the archive on success', async () => {
    const fetchMock = mockApi({
      patchBody: { board: { ...BOARD, name: 'Retro Bingo II' } },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Reprint Retro Bingo' })
    fireEvent.change(screen.getByLabelText('BOARD NAME'), {
      target: { value: 'Retro Bingo II' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reprint it ✓' }))
    expect(
      await screen.findByText(/Archive probe — printed Retro Bingo II/),
    ).toBeDefined()
    const patch = fetchMock.mock.calls.find(
      (call) =>
        call[0] === `/api/boards/${BOARD.id}` &&
        (call[1] as RequestInit | undefined)?.method === 'PATCH',
    )
    expect(patch).toBeDefined()
    expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({
      name: 'Retro Bingo II',
      size: 3,
      terms: TERMS_8,
    })
  })

  it('surfaces a server ApiError in the alert area', async () => {
    mockApi({
      patchStatus: 400,
      patchBody: {
        code: 'invalid_board',
        error: 'That edit won\'t print.',
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Reprint Retro Bingo' })
    fireEvent.click(screen.getByRole('button', { name: 'Reprint it ✓' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      "That edit won't print.",
    )
  })
})
