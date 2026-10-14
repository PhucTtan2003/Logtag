namespace temperature_humi.Infrastructure
{
    public sealed class EventIngestCacheOptions
    {
        // Coalesce per serial trong cửa sổ nhỏ
        public TimeSpan CoalesceWindow { get; set; } = TimeSpan.FromSeconds(2);

        // Flush tối đa theo thời gian (dù chưa đủ batch)
        public TimeSpan FlushInterval { get; set; } = TimeSpan.FromSeconds(1);

        // Batch size tối đa mỗi flush
        public int BatchSize { get; set; } = 1500;

        // Queue bounded để bảo vệ RAM
        public int QueueCapacity { get; set; } = 50_000;

        // Dedupe in-memory để giảm DB (DB vẫn là nguồn thật nhờ unique index)
        public bool EnableInMemoryDedupe { get; set; } = true;

        // TTL dedupe (bạn đang giữ dedupe alert 6h; dedupe ingest có thể 1h–6h tuỳ tải)
        public TimeSpan DedupeTtl { get; set; } = TimeSpan.FromHours(1);

        // Round time khi tạo dedupe key để giảm nổ key (vd 1s)
        public TimeSpan DedupeTimeRounding { get; set; } = TimeSpan.FromSeconds(1);

        // Sweep định kỳ
        public TimeSpan SweepInterval { get; set; } = TimeSpan.FromMinutes(2);

        // Giới hạn số key dedupe trong RAM (0 = không giới hạn)
        public int MaxDedupeKeys { get; set; } = 1_000_000;
    }
}
