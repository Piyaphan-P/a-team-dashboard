import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LogViewer } from '../LogViewer';

// Prevent jsdom errors for missing APIs
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  // Stub URL.createObjectURL / revokeObjectURL for export tests
  global.URL.createObjectURL = vi.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = vi.fn();
  // Stub HTMLAnchorElement.click for download
  HTMLAnchorElement.prototype.click = vi.fn();
});

// Mock logsApi — fetchLogs is async; rangeToSince is used for client filter
vi.mock('../../utils/logsApi.js', () => ({
  fetchLogs: vi.fn().mockResolvedValue({
    entries: [],
    total: 0,
    hasMore: false,
    bufferSize: 0,
    bufferCap: 5000,
  }),
  rangeToSince: vi.fn((range) => {
    if (!range || range === 'all') return undefined;
    const now = Date.now();
    if (range === 'today') return now - 86400000;
    if (range === '7d') return now - 7 * 86400000;
    if (range === '30d') return now - 30 * 86400000;
    return undefined;
  }),
}));

// Mock toast to capture toasts in tests
vi.mock('react-hot-toast', () => ({
  default: vi.fn(),
}));

// Import after mocking
import { fetchLogs } from '../../utils/logsApi.js';
import toast from 'react-hot-toast';

// ---- helpers ----
function makeEntry(overrides = {}) {
  return {
    entryId: `team1/task-001#created@${Date.now()}`,
    timestamp: Date.now(),
    agent: 'agent-alpha',
    team: 'team1',
    taskId: 'task-001',
    action: 'created',
    type: 'task',
    summary: '[pending] Build the thing',
    status: 'pending',
    feature: null,
    stage: null,
    raw: { subject: 'Build the thing', status: 'pending' },
    ...overrides,
  };
}

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  fetchLogs.mockResolvedValue({
    entries: [],
    total: 0,
    hasMore: false,
    bufferSize: 0,
    bufferCap: 5000,
  });
});

// ---- tests ----
describe('LogViewer', () => {

  describe('empty state', () => {
    it('shows empty-state message when no entries and no filters active', async () => {
      render(<LogViewer logs={[]} />);
      await waitFor(() => expect(screen.queryByText(/No log entries yet/i)).toBeInTheDocument());
    });

    it('shows friendly empty-state hint text', async () => {
      render(<LogViewer logs={[]} />);
      await waitFor(() =>
        expect(screen.getByText(/Log entries will appear here when tasks run/i)).toBeInTheDocument()
      );
    });

    it('shows filter-specific empty message when filters active', async () => {
      render(<LogViewer logs={[]} />);
      // Select a type filter
      const typeSelect = await screen.findByLabelText(/type/i);
      await act(async () => { fireEvent.change(typeSelect, { target: { value: 'status' } }); });
      await waitFor(() =>
        expect(screen.getByText(/No entries match your filters/i)).toBeInTheDocument()
      );
    });
  });

  describe('loading state', () => {
    it('shows SkeletonInboxViewer when loading=true and no entries yet', async () => {
      // Make fetchLogs hang
      fetchLogs.mockReturnValue(new Promise(() => {}));
      const { container } = render(<LogViewer logs={[]} loading={true} />);
      // SkeletonInboxViewer renders a card with animate-pulse
      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });
  });

  describe('populated state', () => {
    it('renders log entry summary', async () => {
      const entry = makeEntry({ summary: '[pending] Build the thing' });
      fetchLogs.mockResolvedValue({
        entries: [entry],
        total: 1,
        hasMore: false,
        bufferSize: 1,
        bufferCap: 5000,
      });
      render(<LogViewer logs={[]} />);
      await waitFor(() => expect(screen.getByText('[pending] Build the thing')).toBeInTheDocument());
    });

    it('renders agent name in log row', async () => {
      const entry = makeEntry({ agent: 'agent-alpha' });
      fetchLogs.mockResolvedValue({ entries: [entry], total: 1, hasMore: false });
      render(<LogViewer logs={[]} />);
      await waitFor(() => expect(screen.getAllByText('agent-alpha').length).toBeGreaterThanOrEqual(1));
    });

    it('renders action badge for each entry', async () => {
      const entry = makeEntry({ action: 'created' });
      fetchLogs.mockResolvedValue({ entries: [entry], total: 1, hasMore: false });
      render(<LogViewer logs={[]} />);
      await waitFor(() => expect(screen.getByText(/created/i)).toBeInTheDocument());
    });

    it('shows entry count in header', async () => {
      const entries = [makeEntry(), makeEntry({ entryId: 'team1/task-002#created@1' })];
      fetchLogs.mockResolvedValue({ entries, total: 2, hasMore: false });
      render(<LogViewer logs={[]} />);
      await waitFor(() => expect(screen.getByText(/2 entries? shown/i)).toBeInTheDocument());
    });
  });

  describe('filters', () => {
    it('renders agent dropdown with All agents option', async () => {
      render(<LogViewer logs={[]} />);
      const select = await screen.findByLabelText(/agent/i);
      expect(select).toBeInTheDocument();
      expect(screen.getByText('All agents')).toBeInTheDocument();
    });

    it('renders type dropdown with All, task, status, system options', async () => {
      render(<LogViewer logs={[]} />);
      const typeSelect = await screen.findByLabelText(/type/i);
      expect(typeSelect).toBeInTheDocument();
      // Use queryAllByText to handle multiple elements with same text
      expect(screen.queryAllByText('All').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('task')).toBeInTheDocument();
      expect(screen.getByText('status')).toBeInTheDocument();
      expect(screen.getByText('system')).toBeInTheDocument();
    });

    it('renders time range radio group with four options', async () => {
      render(<LogViewer logs={[]} />);
      await waitFor(() => {
        expect(screen.getByLabelText(/all/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/today/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/last 7 days/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/last 30 days/i)).toBeInTheDocument();
      });
    });

    it('re-fetches with agent filter when agent dropdown changes', async () => {
      const entry = makeEntry({ agent: 'agent-beta' });
      fetchLogs.mockResolvedValue({ entries: [entry], total: 1, hasMore: false });
      render(<LogViewer logs={[makeEntry({ agent: 'agent-beta' })]} />);
      await waitFor(() => {});
      vi.clearAllMocks();
      fetchLogs.mockResolvedValue({ entries: [entry], total: 1, hasMore: false });

      const select = screen.getByLabelText(/agent/i);
      await act(async () => { fireEvent.change(select, { target: { value: 'agent-beta' } }); });

      await waitFor(() => {
        expect(fetchLogs).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agent-beta' }));
      });
    });

    it('re-fetches with type filter when type dropdown changes', async () => {
      fetchLogs.mockResolvedValue({ entries: [], total: 0, hasMore: false });
      render(<LogViewer logs={[]} />);
      await waitFor(() => {});
      vi.clearAllMocks();
      fetchLogs.mockResolvedValue({ entries: [], total: 0, hasMore: false });

      const typeSelect = screen.getByLabelText(/type/i);
      await act(async () => { fireEvent.change(typeSelect, { target: { value: 'status' } }); });

      await waitFor(() => {
        expect(fetchLogs).toHaveBeenCalledWith(expect.objectContaining({ type: 'status' }));
      });
    });

    it('re-fetches with since param when time range radio changes', async () => {
      fetchLogs.mockResolvedValue({ entries: [], total: 0, hasMore: false });
      render(<LogViewer logs={[]} />);
      await waitFor(() => {});
      vi.clearAllMocks();
      fetchLogs.mockResolvedValue({ entries: [], total: 0, hasMore: false });

      const todayRadio = screen.getByLabelText(/today/i);
      await act(async () => { fireEvent.click(todayRadio); });

      await waitFor(() => {
        expect(fetchLogs).toHaveBeenCalledWith(expect.objectContaining({ since: expect.any(Number) }));
      });
    });

    it('shows Clear filters button when any filter is active', async () => {
      render(<LogViewer logs={[]} />);
      const typeSelect = await screen.findByLabelText(/type/i);
      await act(async () => { fireEvent.change(typeSelect, { target: { value: 'task' } }); });
      await waitFor(() => expect(screen.getByText(/Clear filters/i)).toBeInTheDocument());
    });

    it('clears filters when Clear filters is clicked', async () => {
      render(<LogViewer logs={[]} />);
      const typeSelect = await screen.findByLabelText(/type/i);
      await act(async () => { fireEvent.change(typeSelect, { target: { value: 'task' } }); });
      const clearBtn = await screen.findByText(/Clear filters/i);
      await act(async () => { fireEvent.click(clearBtn); });
      await waitFor(() => expect(screen.queryByText(/Clear filters/i)).not.toBeInTheDocument());
    });
  });

  describe('load more', () => {
    it('shows Load more button when hasMore=true', async () => {
      fetchLogs.mockResolvedValue({
        entries: [makeEntry()],
        total: 100,
        hasMore: true,
      });
      render(<LogViewer logs={[]} />);
      await waitFor(() => expect(screen.getByText('Load more')).toBeInTheDocument());
    });

    it('does not show Load more when hasMore=false', async () => {
      fetchLogs.mockResolvedValue({ entries: [makeEntry()], total: 1, hasMore: false });
      render(<LogViewer logs={[]} />);
      await waitFor(() => expect(screen.queryByText('Load more')).not.toBeInTheDocument());
    });

    it('calls fetchLogs with incremented offset when Load more clicked', async () => {
      // First call returns 50 entries with hasMore true
      const entries50 = Array.from({ length: 50 }, (_, i) => makeEntry({ entryId: `team1/task-${i}#created@${i}` }));
      fetchLogs.mockResolvedValueOnce({ entries: entries50, total: 100, hasMore: true });
      fetchLogs.mockResolvedValue({ entries: [], total: 100, hasMore: false });

      render(<LogViewer logs={[]} />);
      const loadMoreBtn = await screen.findByText('Load more');

      await act(async () => { fireEvent.click(loadMoreBtn); });

      await waitFor(() => {
        const calls = fetchLogs.mock.calls;
        const secondCall = calls[calls.length - 1][0];
        expect(secondCall.offset).toBe(50);
      });
    });
  });

  describe('row expand/collapse', () => {
    it('clicking a row expands raw JSON pre block', async () => {
      const raw = { subject: 'Test task', status: 'pending' };
      const entry = makeEntry({ raw });
      fetchLogs.mockResolvedValue({ entries: [entry], total: 1, hasMore: false });
      render(<LogViewer logs={[]} />);

      // wait for entry to appear, then find the collapsed log row
      await waitFor(() => expect(screen.getByText('[pending] Build the thing')).toBeInTheDocument());
      const rows = screen.getAllByRole('button');
      const logRow = rows.find(r => r.getAttribute('aria-expanded') === 'false');
      expect(logRow).toBeDefined();

      await act(async () => { fireEvent.click(logRow); });
      await waitFor(() => expect(screen.getByText(/"subject": "Test task"/i)).toBeInTheDocument());
    });

    it('clicking expanded row collapses it again', async () => {
      const entry = makeEntry({ raw: { subject: 'Build' } });
      fetchLogs.mockResolvedValue({ entries: [entry], total: 1, hasMore: false });
      render(<LogViewer logs={[]} />);

      await waitFor(() => expect(screen.getByText('[pending] Build the thing')).toBeInTheDocument());
      const rows = screen.getAllByRole('button');
      const logRow = rows.find(r => r.getAttribute('aria-expanded') === 'false');

      // expand
      await act(async () => { fireEvent.click(logRow); });
      await waitFor(() => expect(screen.getByText(/"subject": "Build"/i)).toBeInTheDocument());

      // collapse
      await act(async () => { fireEvent.click(logRow); });
      await waitFor(() => expect(screen.queryByText(/"subject": "Build"/i)).not.toBeInTheDocument());
    });
  });

  describe('live WS entries', () => {
    it('prepends live WS entries above REST entries', async () => {
      const restEntry = makeEntry({ entryId: 'rest-1', summary: '[pending] REST entry', agent: 'agent-rest' });
      fetchLogs.mockResolvedValue({ entries: [restEntry], total: 1, hasMore: false });

      const { rerender } = render(<LogViewer logs={[]} />);
      await waitFor(() => expect(screen.getByText('[pending] REST entry')).toBeInTheDocument());

      const wsEntry = makeEntry({ entryId: 'ws-1', summary: '[in_progress] WS entry', agent: 'agent-ws' });
      rerender(<LogViewer logs={[wsEntry]} />);

      await waitFor(() => {
        expect(screen.getByText('[in_progress] WS entry')).toBeInTheDocument();
        expect(screen.getByText('[pending] REST entry')).toBeInTheDocument();
      });
    });

    it('deduplicates entries with same entryId from WS and REST', async () => {
      const sharedId = 'team1/task-001#created@1000';
      const restEntry = makeEntry({ entryId: sharedId, summary: '[pending] Shared entry' });
      fetchLogs.mockResolvedValue({ entries: [restEntry], total: 1, hasMore: false });

      const wsEntry = makeEntry({ entryId: sharedId, summary: '[pending] Shared entry' });
      render(<LogViewer logs={[wsEntry]} />);

      await waitFor(() => {
        const items = screen.getAllByText('[pending] Shared entry');
        // Only one instance despite appearing in both sources
        expect(items).toHaveLength(1);
      });
    });
  });

  describe('export buttons', () => {
    it('renders Export JSON and Export CSV buttons', async () => {
      render(<LogViewer logs={[]} />);
      expect(await screen.findByRole('button', { name: /Export JSON/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument();
    });

    it('triggers download when Export JSON is clicked', async () => {
      const entry = makeEntry();
      fetchLogs.mockResolvedValue({ entries: [entry], total: 1, hasMore: false });
      render(<LogViewer logs={[]} />);

      const btn = await screen.findByRole('button', { name: /Export JSON/i });
      await act(async () => { fireEvent.click(btn); });

      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    it('triggers download when Export CSV is clicked', async () => {
      const entry = makeEntry();
      fetchLogs.mockResolvedValue({ entries: [entry], total: 1, hasMore: false });
      render(<LogViewer logs={[]} />);

      const btn = await screen.findByRole('button', { name: /Export CSV/i });
      await act(async () => { fireEvent.click(btn); });

      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    it('shows toast when export exceeds 10,000 rows', async () => {
      // Produce >10000 entries via WS logs prop
      const hugeLogs = Array.from({ length: 10001 }, (_, i) =>
        makeEntry({ entryId: `team1/t-${i}#c@${i}`, summary: `summary ${i}` })
      );
      render(<LogViewer logs={hugeLogs} />);

      const btn = await screen.findByRole('button', { name: /Export JSON/i }, { timeout: 30000 });
      await act(async () => { fireEvent.click(btn); });

      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('trimmed to first 10,000'),
        expect.anything()
      );
    }, 60000);
  });
});
