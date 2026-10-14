using System.Collections.Concurrent;
using System.Threading.Channels;
using temperature_humi.Data;

namespace temperature_humi.Infrastructure
{
    /// <summary>
    /// Cache ingest cho EventService:
    /// - Enqueue Event docs (đã normalize)
    /// - Coalesce theo serial trong CoalesceWindow
    /// - Batch flush gọi callback InsertManySkipDuplicatesAsync(docs)
    /// - Optional in-memory dedupe TTL (giảm write trùng)
    /// </summary>
    public sealed class EventIngestProcessingCache
    {
        private sealed record Item(string Serial, List<Event> Docs, DateTimeOffset EnqueuedAtUtc);

        private sealed class SerialBuffer
        {
            public readonly List<Event> Docs = new();
            public DateTimeOffset LastEnqueueUtc;
        }

        private sealed class DedupeEntry
        {
            public DateTimeOffset SeenAtUtc;
        }

        private readonly EventIngestCacheOptions _opt;
        private readonly Channel<Item> _queue;

        // coalesce buffers
        private readonly ConcurrentDictionary<string, SerialBuffer> _buffers = new(StringComparer.OrdinalIgnoreCase);

        // in-memory dedupe (key => seenAt)
        private readonly ConcurrentDictionary<string, DedupeEntry> _dedupe = new();

        private DateTimeOffset _lastSweepUtc = DateTimeOffset.UtcNow;

        // callback flush: thường sẽ là EventService.InsertManySkipDuplicatesAsync
        private readonly Func<List<Event>, CancellationToken, Task<int>> _flushAsync;

        public EventIngestProcessingCache(
            EventIngestCacheOptions opt,
            Func<List<Event>, CancellationToken, Task<int>> flushAsync)
        {
            _opt = opt ?? throw new ArgumentNullException(nameof(opt));
            _flushAsync = flushAsync ?? throw new ArgumentNullException(nameof(flushAsync));

            _queue = Channel.CreateBounded<Item>(new BoundedChannelOptions(Math.Max(1, _opt.QueueCapacity))
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.DropOldest // ưu tiên "mượt"
            });
        }

        private static string Norm(string s) => (s ?? "").Trim().ToUpperInvariant();

        private DateTimeOffset RoundTime(DateTimeOffset t)
        {
            var round = _opt.DedupeTimeRounding;
            if (round <= TimeSpan.Zero) return t;

            var ticks = round.Ticks;
            var roundedTicks = (t.UtcTicks / ticks) * ticks;
            return new DateTimeOffset(roundedTicks, TimeSpan.Zero);
        }

        private string BuildDedupeKey(Event ev)
        {
            // DB unique: serial + eventTimeUtc + eventType
            // Dedupe memory: same idea, but allow rounding to reduce key explosion
            var serial = Norm(ev.serialNumber);
            var type = (ev.eventType ?? "").Trim().ToLowerInvariant();
            var t = RoundTime(new DateTimeOffset(ev.eventTimeUtc, TimeSpan.Zero));
            return $"{serial}|{type}|{t:O}";
        }

        private bool TryMarkDedupe(Event ev, DateTimeOffset now)
        {
            if (!_opt.EnableInMemoryDedupe) return true;

            if (_opt.MaxDedupeKeys > 0 && _dedupe.Count >= _opt.MaxDedupeKeys)
                return false; // protect memory

            var key = BuildDedupeKey(ev);

            if (_dedupe.TryGetValue(key, out var seen))
            {
                if (now - seen.SeenAtUtc < _opt.DedupeTtl) return false;
                seen.SeenAtUtc = now;
                return true;
            }

            _dedupe[key] = new DedupeEntry { SeenAtUtc = now };
            return true;
        }

        /// <summary>
        /// Enqueue một batch docs theo serial (docs đã normalize serial/type/time).
        /// Return số docs thực sự được nhận (sau in-memory dedupe).
        /// </summary>
        public int TryEnqueue(string serialNumber, List<Event> docs)
        {
            if (docs == null || docs.Count == 0) return 0;

            var serial = Norm(serialNumber);
            var now = DateTimeOffset.UtcNow;

            // lọc dedupe memory (optional)
            List<Event>? accepted = null;
            if (_opt.EnableInMemoryDedupe)
            {
                accepted = new List<Event>(docs.Count);
                foreach (var d in docs)
                {
                    d.serialNumber = serial; // enforce
                    if (TryMarkDedupe(d, now))
                        accepted.Add(d);
                }
            }
            else
            {
                accepted = docs;
            }

            if (accepted.Count == 0) return 0;

            var item = new Item(serial, accepted, now);
            return _queue.Writer.TryWrite(item) ? accepted.Count : 0;
        }

        public async Task RunAsync(CancellationToken ct)
        {
            var batch = new List<Event>(_opt.BatchSize);
            var lastFlush = DateTimeOffset.UtcNow;

            while (await _queue.Reader.WaitToReadAsync(ct).ConfigureAwait(false))
            {
                while (_queue.Reader.TryRead(out var item))
                {
                    var buf = _buffers.GetOrAdd(item.Serial, _ => new SerialBuffer());
                    lock (buf)
                    {
                        buf.Docs.AddRange(item.Docs);
                        buf.LastEnqueueUtc = item.EnqueuedAtUtc;
                    }
                }

                var now = DateTimeOffset.UtcNow;

                // sweep định kỳ
                if (now - _lastSweepUtc >= _opt.SweepInterval)
                {
                    Sweep(now);
                    _lastSweepUtc = now;
                }

                // flush các serial đã “đủ cửa sổ”
                FlushDueBuffersInto(batch, now);

                var timeDue = (now - lastFlush) >= _opt.FlushInterval;
                var sizeDue = batch.Count >= _opt.BatchSize;

                if ((timeDue || sizeDue) && batch.Count > 0)
                {
                    // flush ra EventService (bulk insert + PublishRecentAlertsAsync + SMS)
                    var toFlush = batch;
                    batch = new List<Event>(_opt.BatchSize);

                    try
                    {
                        // _flushAsync sẽ handle dup (11000) & publish alerts như code bạn đang có
                        await _flushAsync(toFlush, ct).ConfigureAwait(false);
                    }
                    catch
                    {
                        // không throw để worker không chết; bạn log ở ngoài worker nếu muốn
                    }

                    lastFlush = DateTimeOffset.UtcNow;
                }

                // nhường CPU chút
                await Task.Delay(30, ct).ConfigureAwait(false);
            }
        }

        private void FlushDueBuffersInto(List<Event> outBatch, DateTimeOffset now)
        {
            foreach (var kv in _buffers)
            {
                var serial = kv.Key;
                var buf = kv.Value;

                List<Event>? drained = null;

                lock (buf)
                {
                    if (buf.Docs.Count == 0) continue;

                    if ((now - buf.LastEnqueueUtc) >= _opt.CoalesceWindow)
                    {
                        drained = new List<Event>(buf.Docs);
                        buf.Docs.Clear();
                    }
                }

                if (drained != null && drained.Count > 0)
                {
                    outBatch.AddRange(drained);

                    // cleanup buffer rỗng để giảm memory
                    _buffers.TryRemove(serial, out _);

                    if (outBatch.Count >= _opt.BatchSize)
                        return;
                }
            }
        }

        private void Sweep(DateTimeOffset now)
        {
            // sweep dedupe
            if (_opt.EnableInMemoryDedupe)
            {
                var cutoff = now - _opt.DedupeTtl;
                foreach (var kv in _dedupe)
                {
                    if (kv.Value.SeenAtUtc < cutoff)
                        _dedupe.TryRemove(kv.Key, out _);
                }
            }

            // sweep buffers quá cũ (phòng treo)
            var bufCutoff = now - (_opt.CoalesceWindow + TimeSpan.FromSeconds(10));
            foreach (var kv in _buffers)
            {
                var buf = kv.Value;
                bool stale;
                lock (buf)
                {
                    stale = buf.Docs.Count == 0 && buf.LastEnqueueUtc < bufCutoff;
                }
                if (stale) _buffers.TryRemove(kv.Key, out _);
            }
        }
    }
}
