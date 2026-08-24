import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SessionProvider } from '../lib/session'
import { AdminUsersPage } from './AdminUsersPage'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }
}

const ADMIN_ME = {
  player: { id: 'a1', name: 'Seamus' },
  needsPasswordReset: false,
  isAdmin: true,
}

const ROSTER = [
  {
    id: 'a1',
    name: 'Seamus',
    needsPasswordReset: false,
    isAdmin: true,
    createdAt: '2026-08-23 00:00:00',
  },
  {
    id: 'p2',
    name: 'Ruth',
    needsPasswordReset: true,
    isAdmin: false,
    createdAt: '2026-08-23 00:01:00',
  },
]

function mockApi({
  provisionStatus = 201,
  provisionBody = null,
  reissueBody = null,
}: {
  provisionStatus?: number
  provisionBody?: unknown
  reissueBody?: unknown
} = {}) {
  const fetchMock = vi.fn().mockImplementation(
    (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/me') return Promise.resolve(jsonResponse(200, ADMIN_ME))
      if (url === '/api/players' && method === 'GET') {
        return Promise.resolve(jsonResponse(200, { players: ROSTER }))
      }
      if (url === '/api/players' && method === 'POST') {
        return Promise.resolve(jsonResponse(provisionStatus, provisionBody))
      }
      if (/^\/api\/players\/[^/]+\/code$/.test(url) && method === 'POST') {
        return Promise.resolve(jsonResponse(200, reissueBody))
      }
      return Promise.resolve(jsonResponse(404, { code: 'not_found', error: 'nope' }))
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <SessionProvider>
        <Routes>
          <Route path="/admin/users" element={<AdminUsersPage />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AdminUsersPage', () => {
  it('lists the roster with badges', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByText('Ruth')).toBeDefined()
    expect(screen.getByText('ADMIN')).toBeDefined()
    expect(screen.getByText('NEEDS CODE')).toBeDefined()
  })

  it('provisions a player and shows the code once, with a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } })
    mockApi({
      provisionBody: {
        player: { id: 'p3', name: 'Priya' },
        oneTimeCode: 'ABCD-EFGH',
      },
    })
    renderPage()
    fireEvent.change(await screen.findByLabelText("NEW PLAYER'S NAME"), {
      target: { value: 'Priya' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create player' }))
    expect(await screen.findByText('ABCD-EFGH')).toBeDefined()
    expect(screen.getByText(/Shown once/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeDefined()
    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH')
  })

  it('surfaces a name-taken error from the server', async () => {
    mockApi({
      provisionStatus: 409,
      provisionBody: { code: 'name_taken', error: '"Ruth" is taken.' },
    })
    renderPage()
    fireEvent.change(await screen.findByLabelText("NEW PLAYER'S NAME"), {
      target: { value: 'Ruth' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create player' }))
    expect((await screen.findByRole('alert')).textContent).toContain('taken')
  })

  it('re-issues a code behind a confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockApi({ reissueBody: { oneTimeCode: 'WXYZ-2345' } })
    renderPage()
    const buttons = await screen.findAllByRole('button', { name: 'Re-issue code' })
    fireEvent.click(buttons[1]!)
    expect(confirmSpy).toHaveBeenCalled()
    expect(await screen.findByText('WXYZ-2345')).toBeDefined()
    expect(screen.getByText(/One-time code for Ruth/)).toBeDefined()
  })

  it('does nothing when the confirm is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fetchMock = mockApi()
    renderPage()
    const buttons = await screen.findAllByRole('button', { name: 'Re-issue code' })
    fireEvent.click(buttons[1]!)
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/players/p2/code',
      expect.anything(),
    )
  })
})
